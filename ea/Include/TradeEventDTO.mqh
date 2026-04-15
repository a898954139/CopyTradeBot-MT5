//+------------------------------------------------------------------+
//| TradeEventDTO.mqh - Normalized trade event data transfer object  |
//+------------------------------------------------------------------+
#ifndef TRADE_EVENT_DTO_MQH
#define TRADE_EVENT_DTO_MQH

#include "Enums.mqh"

//--- Normalized candidate produced by EventNormalizer
struct NormalizedTradeEventCandidate
{
   // MT5 raw identifiers
   ENUM_TRADE_TRANSACTION_TYPE  trans_type;
   ENUM_ORDER_TYPE              order_type;
   ENUM_DEAL_TYPE               deal_type;
   ENUM_DEAL_ENTRY              deal_entry;
   ENUM_DEAL_REASON             deal_reason;
   ENUM_ORDER_STATE             order_state;

   // Tickets and IDs
   ulong    order_ticket;
   ulong    deal_ticket;
   ulong    position_id;

   // Trade details
   string   symbol;
   double   volume;
   double   price;
   double   sl;
   double   tp;
   double   prev_sl;
   double   prev_tp;
   double   prev_volume;
   double   open_price;
   double   total_volume;

   // Direction as string (BUY / SELL)
   string   direction;

   // Metadata
   long     magic;
   string   comment;
   string   reason_string;
   datetime trans_time;
   long     time_msc;

   // Flags
   bool     has_deal;
   bool     has_order;
   bool     has_position;
   bool     is_pending_order;
};

//--- Final classified event ready for webhook delivery
struct ClassifiedTradeEvent
{
   ENUM_BUSINESS_EVENT  event_type;
   string               idempotency_key;
   string               source;
   long                 account;
   string               server;
   string               terminal_id;
   datetime             occurred_at;
   long                 occurred_at_msc;

   // From normalized candidate
   string   symbol;
   ulong    position_id;
   ulong    order_ticket;
   ulong    deal_ticket;
   string   direction;
   double   volume;
   double   price;
   double   sl;
   double   tp;
   double   open_price;
   double   total_volume;
   string   reason;
   string   comment;
   long     magic;
   string   correlation_id;

   // Raw context for debugging
   ENUM_TRADE_TRANSACTION_TYPE  raw_trans_type;
   ENUM_ORDER_TYPE              raw_order_type;
   ENUM_DEAL_TYPE               raw_deal_type;
   ENUM_DEAL_ENTRY              raw_deal_entry;
   ENUM_DEAL_REASON             raw_deal_reason;
};

#endif
