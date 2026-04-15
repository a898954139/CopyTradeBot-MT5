//+------------------------------------------------------------------+
//| JsonSerializer.mqh - Serialize ClassifiedTradeEvent to JSON      |
//+------------------------------------------------------------------+
#ifndef JSON_SERIALIZER_MQH
#define JSON_SERIALIZER_MQH

#include "TradeEventDTO.mqh"

//+------------------------------------------------------------------+
//| Manual JSON builder (MQL5 has no native JSON library)             |
//+------------------------------------------------------------------+
class CJsonSerializer
{
public:
   static string Serialize(const ClassifiedTradeEvent &evt)
   {
      string json = "{";

      json += KV("source",         evt.source) + ",";
      json += KVLong("account",    evt.account) + ",";
      json += KV("server",         evt.server) + ",";
      json += KV("terminal_id",    evt.terminal_id) + ",";
      json += KV("event_type",     BusinessEventToString(evt.event_type)) + ",";
      json += KV("idempotency_key", evt.idempotency_key) + ",";
      json += KV("occurred_at",    FormatTimestamp(evt.occurred_at, evt.occurred_at_msc)) + ",";
      json += KV("symbol",         evt.symbol) + ",";
      json += KVNullableUlong("position_id",  evt.position_id) + ",";
      json += KVNullableUlong("order_ticket",  evt.order_ticket) + ",";
      json += KVNullableUlong("deal_ticket",   evt.deal_ticket) + ",";
      json += KVNullable("direction", evt.direction) + ",";
      json += KVDouble("volume",   evt.volume, 2) + ",";
      json += KVDouble("price",    evt.price, 5) + ",";
      json += KVDouble("sl",       evt.sl, 5) + ",";
      json += KVDouble("tp",       evt.tp, 5) + ",";
      json += KVDouble("open_price", evt.open_price, 5) + ",";
      json += KVDouble("total_volume", evt.total_volume, 2) + ",";
      json += KV("reason",         evt.reason) + ",";
      json += KV("comment",        evt.comment) + ",";
      json += KVLong("magic",      evt.magic) + ",";
      json += KVNullable("correlation_id", evt.correlation_id) + ",";
      json += "\"raw\":{" +
              KV("trans_type",  EnumToString(evt.raw_trans_type)) + "," +
              KV("order_type",  EnumToString(evt.raw_order_type)) + "," +
              KV("deal_type",   EnumToString(evt.raw_deal_type)) + "," +
              KV("deal_entry",  EnumToString(evt.raw_deal_entry)) + "," +
              KV("deal_reason", EnumToString(evt.raw_deal_reason)) +
              "}";

      json += "}";
      return json;
   }

private:
   //--- Key-value helpers
   static string KV(string key, string value)
   {
      // Escape quotes in value
      StringReplace(value, "\\", "\\\\");
      StringReplace(value, "\"", "\\\"");
      return "\"" + key + "\":\"" + value + "\"";
   }

   static string KVLong(string key, long value)
   {
      return "\"" + key + "\":\"" + IntegerToString(value) + "\"";
   }

   static string KVDouble(string key, double value, int digits)
   {
      return "\"" + key + "\":" + DoubleToString(value, digits);
   }

   static string KVNullable(string key, string value)
   {
      if(value == "" || value == NULL)
         return "\"" + key + "\":null";
      return KV(key, value);
   }

   static string KVNullableUlong(string key, ulong value)
   {
      if(value == 0)
         return "\"" + key + "\":null";
      return "\"" + key + "\":\"" + IntegerToString((long)value) + "\"";
   }

   //--- Format timestamp as ISO 8601
   static string FormatTimestamp(datetime time, long time_msc)
   {
      MqlDateTime dt;
      TimeToStruct(time, dt);
      int ms = (int)(time_msc % 1000);

      return StringFormat("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                          dt.year, dt.mon, dt.day,
                          dt.hour, dt.min, dt.sec, ms);
   }
};

#endif
