//+------------------------------------------------------------------+
//| EventClassifier.mqh - Table-driven business event classification |
//+------------------------------------------------------------------+
#ifndef EVENT_CLASSIFIER_MQH
#define EVENT_CLASSIFIER_MQH

#include "TradeEventDTO.mqh"

//+------------------------------------------------------------------+
//| Classification matrix for MT5 transactions                       |
//|                                                                  |
//| Pipeline:                                                        |
//|  1. Is this a pending order lifecycle event?                     |
//|  2. Does this transaction carry a deal?                          |
//|  3. If deal exists: inspect entry, reason, position              |
//|  4. If no deal: check for SL/TP modification only                |
//|  5. Avoid classifying edits as executions                        |
//+------------------------------------------------------------------+
class CEventClassifier
{
public:
   //--- Classify a normalized candidate into a business event
   static ENUM_BUSINESS_EVENT Classify(const NormalizedTradeEventCandidate &c)
   {
      //--- Step 1: Pending order lifecycle (no deal involved)
      ENUM_BUSINESS_EVENT pendingEvent = ClassifyPendingOrder(c);
      if(pendingEvent != BE_NONE)
         return pendingEvent;

      //--- Step 2: Deal-based execution events
      if(c.has_deal)
      {
         ENUM_BUSINESS_EVENT dealEvent = ClassifyDealEvent(c);
         if(dealEvent != BE_NONE)
            return dealEvent;
      }

      //--- Step 3: SL/TP modification (no deal, position exists)
      ENUM_BUSINESS_EVENT slTpEvent = ClassifySLTPModification(c);
      if(slTpEvent != BE_NONE)
         return slTpEvent;

      return BE_NONE;
   }

private:
   //+------------------------------------------------------------------+
   //| Step 1: Pending order lifecycle classification                    |
   //|                                                                   |
   //| Trans Type              | Order State       | Result              |
   //| ----------------------- | ----------------- | ------------------- |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_PLACED     | CREATED        |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_PARTIAL    | UPDATED        |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_CANCELED   | CANCELLED      |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_EXPIRED    | CANCELLED      |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_REJECTED   | CANCELLED      |
   //| TRADE_TRANSACTION_ORDER | ORDER_STATE_FILLED     | FILLED         |
   //+------------------------------------------------------------------+
   static ENUM_BUSINESS_EVENT ClassifyPendingOrder(const NormalizedTradeEventCandidate &c)
   {
      // Order lifecycle events come as ORDER_ADD, ORDER_UPDATE, ORDER_DELETE
      if(c.trans_type != TRADE_TRANSACTION_ORDER_ADD &&
         c.trans_type != TRADE_TRANSACTION_ORDER_UPDATE &&
         c.trans_type != TRADE_TRANSACTION_ORDER_DELETE)
         return BE_NONE;

      if(!c.is_pending_order && !c.has_order)
         return BE_NONE;

      // Must be a pending order type to enter this branch
      if(!c.is_pending_order)
         return BE_NONE;

      switch(c.order_state)
      {
         case ORDER_STATE_PLACED:
         {
            // Check if we've seen this order ticket before
            // First time = CREATED, subsequent = UPDATED
            bool seen = IsOrderSeen(c.order_ticket);
            if(!seen)
               AddSeenOrder(c.order_ticket);
            return seen ? BE_PENDING_ORDER_UPDATED : BE_PENDING_ORDER_CREATED;
         }

         case ORDER_STATE_PARTIAL:
            return BE_PENDING_ORDER_UPDATED;

         case ORDER_STATE_CANCELED:
         case ORDER_STATE_EXPIRED:
         case ORDER_STATE_REJECTED:
            return BE_PENDING_ORDER_CANCELLED;

         case ORDER_STATE_FILLED:
            return BE_PENDING_ORDER_FILLED;

         default:
            return BE_NONE;
      }
   }

   //+------------------------------------------------------------------+
   //| Step 2: Deal-based execution classification                       |
   //|                                                                   |
   //| Deal Entry    | Deal Reason    | Position Live? | Result           |
   //| ------------- | -------------- | -------------- | ---------------- |
   //| DEAL_ENTRY_IN | any            | new            | POSITION_OPENED  |
   //| DEAL_ENTRY_IN | any            | existing       | POSITION_INCREASED|
   //| DEAL_ENTRY_OUT| DEAL_REASON_SL | -              | SL_TRIGGERED     |
   //| DEAL_ENTRY_OUT| DEAL_REASON_TP | -              | TP_TRIGGERED     |
   //| DEAL_ENTRY_OUT| other          | pos remains    | PARTIALLY_CLOSED |
   //| DEAL_ENTRY_OUT| other          | pos gone       | POSITION_CLOSED  |
   //| DEAL_ENTRY_INOUT| -            | -              | POSITION_CLOSED+ |
   //|               |                |                | POSITION_OPENED  |
   //+------------------------------------------------------------------+
   static ENUM_BUSINESS_EVENT ClassifyDealEvent(const NormalizedTradeEventCandidate &c)
   {
      // Must be TRADE_TRANSACTION_DEAL_ADD to be a real execution
      if(c.trans_type != TRADE_TRANSACTION_DEAL_ADD)
         return BE_NONE;

      // Only classify buy/sell deals (skip balance, commission, etc.)
      if(c.deal_type != DEAL_TYPE_BUY && c.deal_type != DEAL_TYPE_SELL)
         return BE_NONE;

      //--- Entry deals: opening or increasing a position
      if(c.deal_entry == DEAL_ENTRY_IN)
      {
         return IsNewPosition(c) ? BE_POSITION_OPENED : BE_POSITION_INCREASED;
      }

      //--- Exit deals: closing, partial close, or SL/TP trigger
      if(c.deal_entry == DEAL_ENTRY_OUT)
      {
         return ClassifyExitDeal(c);
      }

      //--- Close-and-open (hedge reversal): treat as close
      if(c.deal_entry == DEAL_ENTRY_INOUT)
      {
         return BE_POSITION_CLOSED;
      }

      return BE_NONE;
   }

   //--- Determine if this is a brand new position
   static bool IsNewPosition(const NormalizedTradeEventCandidate &c)
   {
      // If we can't select the position, it may have just been created
      // by this deal. Check if the deal volume equals the position volume.
      if(!PositionSelectByTicket(c.position_id))
         return true;

      double pos_volume = PositionGetDouble(POSITION_VOLUME);

      // If position volume equals deal volume, this deal created the position
      return MathAbs(pos_volume - c.volume) < 0.00001;
   }

   //--- Classify exit deal: SL trigger, TP trigger, partial, or full close
   static ENUM_BUSINESS_EVENT ClassifyExitDeal(const NormalizedTradeEventCandidate &c)
   {
      //--- SL/TP triggered exits take priority
      if(c.deal_reason == DEAL_REASON_SL)
         return BE_STOP_LOSS_TRIGGERED;

      if(c.deal_reason == DEAL_REASON_TP)
         return BE_TAKE_PROFIT_TRIGGERED;

      //--- Check if position still exists (partial vs full close)
      if(PositionSelectByTicket(c.position_id))
      {
         // Position still alive = partial close
         return BE_POSITION_PARTIALLY_CLOSED;
      }

      // Position gone = full close
      return BE_POSITION_CLOSED;
   }

   //+------------------------------------------------------------------+
   //| Step 3: SL/TP modification detection                              |
   //|                                                                   |
   //| Trans Type                        | SL/TP changed? | Result       |
   //| --------------------------------- | -------------- | ------------ |
   //| TRADE_TRANSACTION_POSITION        | SL changed     | SL_UPDATED   |
   //| TRADE_TRANSACTION_POSITION        | TP changed     | TP_UPDATED   |
   //| TRADE_TRANSACTION_REQUEST (modify)| SL changed     | SL_UPDATED   |
   //| TRADE_TRANSACTION_REQUEST (modify)| TP changed     | TP_UPDATED   |
   //+------------------------------------------------------------------+
   static ENUM_BUSINESS_EVENT ClassifySLTPModification(const NormalizedTradeEventCandidate &c)
   {
      // SL/TP modifications arrive as TRADE_TRANSACTION_POSITION
      if(c.trans_type != TRADE_TRANSACTION_POSITION &&
         c.trans_type != TRADE_TRANSACTION_REQUEST)
         return BE_NONE;

      if(!c.has_position)
         return BE_NONE;

      // For POSITION events, the transaction itself carries new SL/TP
      // Compare against what we captured as prev_sl/prev_tp from the position
      // If prev values are zero (first time setting), any non-zero value is a change
      bool sl_changed = (c.sl != c.prev_sl && (c.sl != 0.0 || c.prev_sl != 0.0));
      bool tp_changed = (c.tp != c.prev_tp && (c.tp != 0.0 || c.prev_tp != 0.0));

      if(sl_changed && tp_changed)
         return BE_SL_AND_TP_UPDATED;

      if(sl_changed)
         return BE_SL_UPDATED;

      if(tp_changed)
         return BE_TP_UPDATED;

      return BE_NONE;
   }

   //+------------------------------------------------------------------+
   //| Order ticket cache for pending order create vs update detection   |
   //+------------------------------------------------------------------+
   static ulong  s_seen_orders[];
   static int    s_seen_count;

   static bool IsOrderSeen(ulong ticket)
   {
      for(int i = 0; i < s_seen_count; i++)
         if(s_seen_orders[i] == ticket)
            return true;
      return false;
   }

   static void AddSeenOrder(ulong ticket)
   {
      int max_size = 64;
      if(s_seen_count >= max_size)
      {
         // Shift out oldest half
         int half = max_size / 2;
         for(int i = 0; i < half; i++)
            s_seen_orders[i] = s_seen_orders[i + half];
         s_seen_count = half;
      }
      ArrayResize(s_seen_orders, s_seen_count + 1);
      s_seen_orders[s_seen_count] = ticket;
      s_seen_count++;
   }
};

// Static member initialization
ulong  CEventClassifier::s_seen_orders[];
int    CEventClassifier::s_seen_count = 0;

#endif
