//+------------------------------------------------------------------+
//| IdempotencyKeyBuilder.mqh - Deterministic dedup keys per event   |
//+------------------------------------------------------------------+
#ifndef IDEMPOTENCY_KEY_BUILDER_MQH
#define IDEMPOTENCY_KEY_BUILDER_MQH

#include "TradeEventDTO.mqh"

//+------------------------------------------------------------------+
//| Build idempotency keys using the following rules:                 |
//|                                                                   |
//| Event Category           | Key Format                            |
//| ------------------------ | ------------------------------------- |
//| Deal-based executions    | {account}|{deal_ticket}               |
//| Pending order lifecycle  | {account}|{order_ticket}|{event}|{ms} |
//| SL/TP modifications      | {account}|{pos_id}|{event}|{sl}|{tp}|{ms}|
//+------------------------------------------------------------------+
class CIdempotencyKeyBuilder
{
public:
   static string Build(long account,
                       ENUM_BUSINESS_EVENT event_type,
                       const NormalizedTradeEventCandidate &c)
   {
      string acct = IntegerToString(account);

      switch(event_type)
      {
         //--- Deal-based: unique by deal ticket
         case BE_POSITION_OPENED:
         case BE_POSITION_INCREASED:
         case BE_POSITION_PARTIALLY_CLOSED:
         case BE_POSITION_CLOSED:
         case BE_STOP_LOSS_TRIGGERED:
         case BE_TAKE_PROFIT_TRIGGERED:
            return acct + "|" + IntegerToString((long)c.deal_ticket);

         //--- Pending order lifecycle: unique by order + state + time
         case BE_PENDING_ORDER_CREATED:
         case BE_PENDING_ORDER_UPDATED:
         case BE_PENDING_ORDER_CANCELLED:
         case BE_PENDING_ORDER_FILLED:
            return acct + "|" + IntegerToString((long)c.order_ticket) + "|" +
                   BusinessEventToString(event_type) + "|" +
                   IntegerToString(c.time_msc);

         //--- SL/TP modifications: unique by position + values + time
         case BE_SL_UPDATED:
         case BE_TP_UPDATED:
            return acct + "|" + IntegerToString((long)c.position_id) + "|" +
                   BusinessEventToString(event_type) + "|" +
                   DoubleToString(c.sl, 5) + "|" +
                   DoubleToString(c.tp, 5) + "|" +
                   IntegerToString(c.time_msc);

         default:
            return acct + "|unknown|" + IntegerToString(c.time_msc);
      }
   }
};

#endif
