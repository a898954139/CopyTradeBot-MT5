//+------------------------------------------------------------------+
//| TelegramRelay.mq5 - MT5 EA for trade event relay to Telegram     |
//+------------------------------------------------------------------+
#property copyright "CopyTradeBot"
#property link      ""
#property version   "1.00"
#property strict

#include <CopyTradeBot/Enums.mqh>
#include <CopyTradeBot/TradeEventDTO.mqh>
#include <CopyTradeBot/EventNormalizer.mqh>
#include <CopyTradeBot/EventClassifier.mqh>
#include <CopyTradeBot/IdempotencyKeyBuilder.mqh>
#include <CopyTradeBot/JsonSerializer.mqh>
#include <CopyTradeBot/WebhookClient.mqh>
#include <CopyTradeBot/RetryQueue.mqh>
#include <CopyTradeBot/Logger.mqh>

//--- Input parameters
input string   InpRelayURL     = "http://192.168.1.232:3000/webhooks/mt5/events";  // Relay webhook URL
input string   InpWebhookSecret = "nexus";                                       // HMAC shared secret
input string   InpTerminalID   = "mac-01";                                       // Terminal identifier
input int      InpTimerSeconds = 5;                                            // Retry timer interval (seconds)
input int      InpTimeout      = 5000;                                         // HTTP timeout (ms)

//--- Module instances
CWebhookClient g_webhook;
CRetryQueue    g_retryQueue;

//--- Local dedup cache (recent idempotency keys)
#define DEDUP_CACHE_SIZE 256
string g_dedupCache[DEDUP_CACHE_SIZE];
int    g_dedupIndex = 0;

//--- SL/TP cache per position (to detect which field changed)
#define SLTP_CACHE_SIZE 64
struct SLTPCacheEntry
{
   ulong    position_id;
   double   sl;
   double   tp;
   bool     active;
};
SLTPCacheEntry g_sltpCache[SLTP_CACHE_SIZE];

void InitSLTPCache()
{
   for(int i = 0; i < SLTP_CACHE_SIZE; i++)
      g_sltpCache[i].active = false;
}

//--- Get cached SL/TP for a position. Returns false if not found.
bool GetCachedSLTP(ulong pos_id, double &prev_sl, double &prev_tp)
{
   for(int i = 0; i < SLTP_CACHE_SIZE; i++)
   {
      if(g_sltpCache[i].active && g_sltpCache[i].position_id == pos_id)
      {
         prev_sl = g_sltpCache[i].sl;
         prev_tp = g_sltpCache[i].tp;
         return true;
      }
   }
   return false;
}

//--- Update cached SL/TP for a position
void UpdateSLTPCache(ulong pos_id, double sl, double tp)
{
   // Find existing entry
   for(int i = 0; i < SLTP_CACHE_SIZE; i++)
   {
      if(g_sltpCache[i].active && g_sltpCache[i].position_id == pos_id)
      {
         g_sltpCache[i].sl = sl;
         g_sltpCache[i].tp = tp;
         return;
      }
   }
   // Find empty slot
   for(int i = 0; i < SLTP_CACHE_SIZE; i++)
   {
      if(!g_sltpCache[i].active)
      {
         g_sltpCache[i].position_id = pos_id;
         g_sltpCache[i].sl = sl;
         g_sltpCache[i].tp = tp;
         g_sltpCache[i].active = true;
         return;
      }
   }
   // Cache full, overwrite first slot
   g_sltpCache[0].position_id = pos_id;
   g_sltpCache[0].sl = sl;
   g_sltpCache[0].tp = tp;
}

void RemoveSLTPCache(ulong pos_id)
{
   for(int i = 0; i < SLTP_CACHE_SIZE; i++)
   {
      if(g_sltpCache[i].active && g_sltpCache[i].position_id == pos_id)
      {
         g_sltpCache[i].active = false;
         return;
      }
   }
}

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   g_webhook.Init(InpRelayURL, InpWebhookSecret, InpTimeout);
   g_retryQueue.Init(&g_webhook);

   // Start timer for retry queue processing
   EventSetTimer(InpTimerSeconds);

   // Initialize dedup cache
   for(int i = 0; i < DEDUP_CACHE_SIZE; i++)
      g_dedupCache[i] = "";

   // Initialize SL/TP cache
   InitSLTPCache();

   CLogger::Info("EA", StringFormat("Initialized: url=%s terminal=%s timer=%ds",
                                     InpRelayURL, InpTerminalID, InpTimerSeconds));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   CLogger::Info("EA", StringFormat("Deinitialized: reason=%d queue_depth=%d",
                                     reason, g_retryQueue.Count()));
}

//+------------------------------------------------------------------+
//| Timer handler - process retry queue                               |
//+------------------------------------------------------------------+
void OnTimer()
{
   g_retryQueue.ProcessRetries();
}

//+------------------------------------------------------------------+
//| Trade transaction handler - main entry point                      |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   //--- Log receipt
   CLogger::LogTransactionReceived(trans.type, trans.order, trans.deal, trans.position);

   //--- Step 1: Normalize
   NormalizedTradeEventCandidate candidate;
   if(!CEventNormalizer::Normalize(trans, request, result, candidate))
   {
      CLogger::Warn("EA", "Normalization failed, skipping");
      return;
   }

   //--- Step 1b: Inject cached prev SL/TP for POSITION events
   if(candidate.trans_type == TRADE_TRANSACTION_POSITION && candidate.has_position)
   {
      double cached_sl = 0, cached_tp = 0;
      if(GetCachedSLTP(candidate.position_id, cached_sl, cached_tp))
      {
         candidate.prev_sl = cached_sl;
         candidate.prev_tp = cached_tp;
      }
   }

   //--- Step 2: Classify
   ENUM_BUSINESS_EVENT event_type = CEventClassifier::Classify(candidate);

   if(event_type == BE_NONE)
   {
      // Still update cache if position has SL/TP (e.g. first open with SL/TP set)
      if(candidate.has_position && (candidate.sl != 0.0 || candidate.tp != 0.0))
         UpdateSLTPCache(candidate.position_id, candidate.sl, candidate.tp);
      return;
   }

   //--- Step 2b: Update SL/TP cache
   if(candidate.has_position)
   {
      if(event_type == BE_POSITION_CLOSED)
         RemoveSLTPCache(candidate.position_id);
      else
         UpdateSLTPCache(candidate.position_id, candidate.sl, candidate.tp);
   }

   //--- Step 3: Build idempotency key
   long account = AccountInfoInteger(ACCOUNT_LOGIN);
   string idempotency_key = CIdempotencyKeyBuilder::Build(account, event_type, candidate);

   //--- Step 4: Local dedup check
   if(IsDuplicate(idempotency_key))
   {
      CLogger::Info("EA", "Duplicate suppressed: " + idempotency_key);
      return;
   }

   //--- Step 5: Build classified event
   ClassifiedTradeEvent evt;
   BuildClassifiedEvent(evt, event_type, idempotency_key, account, candidate);

   //--- Log classification
   CLogger::LogClassification(event_type, evt.symbol, idempotency_key);

   //--- Step 6: Serialize and send
   string json = CJsonSerializer::Serialize(evt);

   ENUM_DELIVERY_STATUS status = g_webhook.Send(json, idempotency_key);

   //--- Step 7: Handle delivery result
   if(status == DS_SUCCESS)
   {
      AddToDedup(idempotency_key);
   }
   else if(status == DS_RETRYABLE_FAILURE)
   {
      // Immediate retry (attempt 0 was the initial send)
      status = g_webhook.Send(json, idempotency_key);
      if(status == DS_SUCCESS)
      {
         AddToDedup(idempotency_key);
      }
      else
      {
         g_retryQueue.Enqueue(json, idempotency_key, 1);
         AddToDedup(idempotency_key);  // Prevent re-emission from new callbacks
      }
   }
   else
   {
      // Non-retryable: log and drop
      CLogger::Error("EA", "Non-retryable failure, dropping: " + idempotency_key);
   }
}

//+------------------------------------------------------------------+
//| Build the final classified event from normalized candidate        |
//+------------------------------------------------------------------+
void BuildClassifiedEvent(ClassifiedTradeEvent &evt,
                          ENUM_BUSINESS_EVENT event_type,
                          string idempotency_key,
                          long account,
                          const NormalizedTradeEventCandidate &c)
{
   evt.event_type       = event_type;
   evt.idempotency_key  = idempotency_key;
   evt.source           = "mt5-ea";
   evt.account          = account;
   evt.server           = AccountInfoString(ACCOUNT_SERVER);
   evt.terminal_id      = InpTerminalID;
   evt.occurred_at      = c.trans_time;
   evt.occurred_at_msc  = c.time_msc;

   evt.symbol           = c.symbol;
   evt.position_id      = c.position_id;
   evt.order_ticket     = c.order_ticket;
   evt.deal_ticket      = c.deal_ticket;
   evt.direction        = c.direction;
   evt.volume           = c.volume;
   evt.price            = c.price;
   evt.sl               = c.sl;
   evt.tp               = c.tp;
   evt.open_price       = c.open_price;
   evt.total_volume     = c.total_volume;
   evt.reason           = c.reason_string;
   evt.comment          = c.comment;
   evt.magic            = c.magic;

   // Correlation ID: use position_id if available, else order_ticket
   if(c.position_id > 0)
      evt.correlation_id = IntegerToString((long)c.position_id);
   else if(c.order_ticket > 0)
      evt.correlation_id = IntegerToString((long)c.order_ticket);
   else
      evt.correlation_id = "";

   // Raw context for debugging
   evt.raw_trans_type   = c.trans_type;
   evt.raw_order_type   = c.order_type;
   evt.raw_deal_type    = c.deal_type;
   evt.raw_deal_entry   = c.deal_entry;
   evt.raw_deal_reason  = c.deal_reason;
}

//+------------------------------------------------------------------+
//| Local dedup: ring buffer of recent idempotency keys               |
//+------------------------------------------------------------------+
bool IsDuplicate(string key)
{
   for(int i = 0; i < DEDUP_CACHE_SIZE; i++)
   {
      if(g_dedupCache[i] == key)
         return true;
   }
   return false;
}

void AddToDedup(string key)
{
   g_dedupCache[g_dedupIndex] = key;
   g_dedupIndex = (g_dedupIndex + 1) % DEDUP_CACHE_SIZE;
}
//+------------------------------------------------------------------+
