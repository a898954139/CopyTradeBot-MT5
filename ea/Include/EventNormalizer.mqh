//+------------------------------------------------------------------+
//| EventNormalizer.mqh - Transform raw MT5 transaction into DTO     |
//+------------------------------------------------------------------+
#ifndef EVENT_NORMALIZER_MQH
#define EVENT_NORMALIZER_MQH

#include "TradeEventDTO.mqh"

//+------------------------------------------------------------------+
//| Normalize a raw OnTradeTransaction callback into a stable DTO    |
//+------------------------------------------------------------------+
class CEventNormalizer
{
public:
   //--- Main entry: build a NormalizedTradeEventCandidate from callback args
   static bool Normalize(const MqlTradeTransaction &trans,
                         const MqlTradeRequest &request,
                         const MqlTradeResult &result,
                         NormalizedTradeEventCandidate &candidate)
   {
      ZeroMemory(candidate);

      candidate.trans_type = trans.type;
      candidate.symbol     = trans.symbol;
      candidate.order_ticket = trans.order;
      candidate.deal_ticket  = trans.deal;
      candidate.position_id  = trans.position;
      candidate.volume     = trans.volume;
      candidate.price      = trans.price;
      candidate.sl         = trans.price_sl;
      candidate.tp         = trans.price_tp;
      candidate.order_type = trans.order_type;
      candidate.order_state = trans.order_state;
      candidate.time_msc   = (long)GetTickCount64();
      candidate.trans_time = TimeCurrent();

      candidate.has_deal     = (trans.deal > 0);
      candidate.has_order    = (trans.order > 0);
      candidate.has_position = (trans.position > 0);
      candidate.is_pending_order = IsPendingOrderType(trans.order_type);

      // Capture position open_price and total_volume BEFORE deal processing
      // (position may be closed by the deal, so grab it first)
      if(candidate.has_position && PositionSelectByTicket(candidate.position_id))
      {
         candidate.open_price    = PositionGetDouble(POSITION_PRICE_OPEN);
         candidate.total_volume  = PositionGetDouble(POSITION_VOLUME);
      }

      // Enrich from deal history if deal exists
      if(candidate.has_deal)
         EnrichFromDeal(candidate);

      // Enrich from order if order exists
      if(candidate.has_order)
         EnrichFromOrder(candidate);

      // Enrich from position if position is live
      if(candidate.has_position)
         EnrichFromPosition(candidate);

      // Derive direction string
      candidate.direction = DeriveDirection(candidate);

      return true;
   }

private:
   //--- Check if order type is pending
   static bool IsPendingOrderType(ENUM_ORDER_TYPE type)
   {
      return (type == ORDER_TYPE_BUY_LIMIT  ||
              type == ORDER_TYPE_SELL_LIMIT ||
              type == ORDER_TYPE_BUY_STOP   ||
              type == ORDER_TYPE_SELL_STOP  ||
              type == ORDER_TYPE_BUY_STOP_LIMIT ||
              type == ORDER_TYPE_SELL_STOP_LIMIT);
   }

   //--- Enrich candidate from deal history
   static void EnrichFromDeal(NormalizedTradeEventCandidate &candidate)
   {
      if(!HistoryDealSelect(candidate.deal_ticket))
         return;

      candidate.deal_type   = (ENUM_DEAL_TYPE)HistoryDealGetInteger(candidate.deal_ticket, DEAL_TYPE);
      candidate.deal_entry  = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(candidate.deal_ticket, DEAL_ENTRY);
      candidate.deal_reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(candidate.deal_ticket, DEAL_REASON);
      candidate.volume      = HistoryDealGetDouble(candidate.deal_ticket, DEAL_VOLUME);
      candidate.price       = HistoryDealGetDouble(candidate.deal_ticket, DEAL_PRICE);
      candidate.magic       = HistoryDealGetInteger(candidate.deal_ticket, DEAL_MAGIC);
      candidate.comment     = HistoryDealGetString(candidate.deal_ticket, DEAL_COMMENT);
      candidate.position_id = (ulong)HistoryDealGetInteger(candidate.deal_ticket, DEAL_POSITION_ID);
      candidate.time_msc    = HistoryDealGetInteger(candidate.deal_ticket, DEAL_TIME_MSC);
      candidate.trans_time  = (datetime)(candidate.time_msc / 1000);

      if(candidate.symbol == "")
         candidate.symbol = HistoryDealGetString(candidate.deal_ticket, DEAL_SYMBOL);

      // Derive direction from deal type first
      if(candidate.deal_type == DEAL_TYPE_BUY)
         candidate.direction = "BUY";
      else if(candidate.deal_type == DEAL_TYPE_SELL)
         candidate.direction = "SELL";

      // For OUT deals, the deal direction is OPPOSITE of the position direction.
      // A SELL deal closes a BUY position, so flip it.
      if(candidate.deal_entry == DEAL_ENTRY_OUT || candidate.deal_entry == DEAL_ENTRY_OUT_BY)
      {
         if(candidate.deal_type == DEAL_TYPE_BUY)
            candidate.direction = "SELL";  // BUY deal closes SELL position
         else if(candidate.deal_type == DEAL_TYPE_SELL)
            candidate.direction = "BUY";   // SELL deal closes BUY position
      }

      // Capture position info if position is still alive
      if(candidate.position_id > 0 && PositionSelectByTicket(candidate.position_id))
      {
         candidate.open_price   = PositionGetDouble(POSITION_PRICE_OPEN);
         candidate.total_volume = PositionGetDouble(POSITION_VOLUME);
         candidate.has_position = true;
      }
      else if(candidate.position_id > 0)
      {
         // Position already closed — try to get open_price from deal history
         // Select all deals for this position to find the opening deal
         if(HistorySelectByPosition(candidate.position_id))
         {
            int total_deals = HistoryDealsTotal();
            for(int i = 0; i < total_deals; i++)
            {
               ulong d_ticket = HistoryDealGetTicket(i);
               if(d_ticket == 0) continue;
               ENUM_DEAL_ENTRY d_entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(d_ticket, DEAL_ENTRY);
               if(d_entry == DEAL_ENTRY_IN)
               {
                  candidate.open_price = HistoryDealGetDouble(d_ticket, DEAL_PRICE);
                  break;
               }
            }
         }
         // total_volume for full close = deal volume (entire position closed)
         candidate.total_volume = candidate.volume;
      }
   }

   //--- Enrich candidate from order info
   static void EnrichFromOrder(NormalizedTradeEventCandidate &candidate)
   {
      // Try history first, then live orders
      if(HistoryOrderSelect(candidate.order_ticket))
      {
         candidate.order_type  = (ENUM_ORDER_TYPE)HistoryOrderGetInteger(candidate.order_ticket, ORDER_TYPE);
         candidate.order_state = (ENUM_ORDER_STATE)HistoryOrderGetInteger(candidate.order_ticket, ORDER_STATE);
         candidate.magic       = HistoryOrderGetInteger(candidate.order_ticket, ORDER_MAGIC);

         if(candidate.symbol == "")
            candidate.symbol = HistoryOrderGetString(candidate.order_ticket, ORDER_SYMBOL);

         if(candidate.sl == 0.0)
            candidate.sl = HistoryOrderGetDouble(candidate.order_ticket, ORDER_SL);
         if(candidate.tp == 0.0)
            candidate.tp = HistoryOrderGetDouble(candidate.order_ticket, ORDER_TP);
      }
      else if(OrderSelect(candidate.order_ticket))
      {
         candidate.order_type  = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
         candidate.order_state = (ENUM_ORDER_STATE)OrderGetInteger(ORDER_STATE);
         candidate.magic       = OrderGetInteger(ORDER_MAGIC);

         if(candidate.symbol == "")
            candidate.symbol = OrderGetString(ORDER_SYMBOL);

         if(candidate.sl == 0.0)
            candidate.sl = OrderGetDouble(ORDER_SL);
         if(candidate.tp == 0.0)
            candidate.tp = OrderGetDouble(ORDER_TP);
      }
   }

   //--- Enrich candidate from live position
   static void EnrichFromPosition(NormalizedTradeEventCandidate &candidate)
   {
      if(!PositionSelectByTicket(candidate.position_id))
         return;

      // For POSITION modification events: the transaction carries the NEW SL/TP
      // The position object already reflects the new values by the time we read it
      // So for SL/TP change detection, we treat:
      //   - candidate.sl/tp (from transaction) = the new values
      //   - We can't get the old values from position since it's already updated
      // Instead, we flag any non-zero SL/TP in the transaction as "changed"
      // by setting prev_sl/prev_tp to 0 when trans_type is POSITION
      if(candidate.trans_type == TRADE_TRANSACTION_POSITION)
      {
         // The transaction's price_sl/price_tp carry the NEW values.
         // We mark prev as 0 so the classifier can detect non-zero as "changed".
         // The classifier will use the idempotency key (which includes SL/TP values)
         // to determine which field actually changed.
         candidate.prev_sl = 0.0;
         candidate.prev_tp = 0.0;

         // Capture open price and direction for SL/TP context
         candidate.price = PositionGetDouble(POSITION_PRICE_OPEN);
         long pos_type = PositionGetInteger(POSITION_TYPE);
         if(pos_type == POSITION_TYPE_BUY)
            candidate.direction = "BUY";
         else if(pos_type == POSITION_TYPE_SELL)
            candidate.direction = "SELL";

         if(candidate.symbol == "")
            candidate.symbol = PositionGetString(POSITION_SYMBOL);

         candidate.prev_volume = PositionGetDouble(POSITION_VOLUME);
         return;
      }

      double pos_sl = PositionGetDouble(POSITION_SL);
      double pos_tp = PositionGetDouble(POSITION_TP);

      // If candidate SL/TP is zero (not set in transaction), use position values
      if(candidate.sl == 0.0)
         candidate.sl = pos_sl;
      if(candidate.tp == 0.0)
         candidate.tp = pos_tp;

      // Store position volume for partial close detection
      candidate.prev_volume = PositionGetDouble(POSITION_VOLUME);

      if(candidate.symbol == "")
         candidate.symbol = PositionGetString(POSITION_SYMBOL);
   }

   //--- Derive human-readable direction
   static string DeriveDirection(const NormalizedTradeEventCandidate &candidate)
   {
      // If direction was already set from deal processing, keep it
      if(candidate.direction == "BUY" || candidate.direction == "SELL")
         return candidate.direction;

      if(candidate.order_type == ORDER_TYPE_BUY       ||
         candidate.order_type == ORDER_TYPE_BUY_LIMIT  ||
         candidate.order_type == ORDER_TYPE_BUY_STOP   ||
         candidate.order_type == ORDER_TYPE_BUY_STOP_LIMIT)
         return "BUY";

      if(candidate.order_type == ORDER_TYPE_SELL      ||
         candidate.order_type == ORDER_TYPE_SELL_LIMIT ||
         candidate.order_type == ORDER_TYPE_SELL_STOP  ||
         candidate.order_type == ORDER_TYPE_SELL_STOP_LIMIT)
         return "SELL";

      return "";
   }
};

#endif
