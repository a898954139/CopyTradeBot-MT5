//+------------------------------------------------------------------+
//| Enums.mqh - Business event types and classification enums        |
//+------------------------------------------------------------------+
#ifndef ENUMS_MQH
#define ENUMS_MQH

//--- Business event types emitted by the classifier
enum ENUM_BUSINESS_EVENT
{
   BE_NONE = 0,

   // Executed trade events
   BE_POSITION_OPENED,
   BE_POSITION_INCREASED,
   BE_POSITION_PARTIALLY_CLOSED,
   BE_POSITION_CLOSED,

   // Protection / exit events
   BE_SL_UPDATED,
   BE_TP_UPDATED,
   BE_STOP_LOSS_TRIGGERED,
   BE_TAKE_PROFIT_TRIGGERED,

   // Pending order lifecycle
   BE_PENDING_ORDER_CREATED,
   BE_PENDING_ORDER_UPDATED,
   BE_PENDING_ORDER_CANCELLED,
   BE_PENDING_ORDER_FILLED
};

//--- Delivery status for webhook sends
enum ENUM_DELIVERY_STATUS
{
   DS_SUCCESS = 0,
   DS_RETRYABLE_FAILURE,
   DS_NON_RETRYABLE_FAILURE,
   DS_PENDING
};

//--- Convert business event enum to string for JSON payload
string BusinessEventToString(ENUM_BUSINESS_EVENT event)
{
   switch(event)
   {
      case BE_POSITION_OPENED:           return "POSITION_OPENED";
      case BE_POSITION_INCREASED:        return "POSITION_INCREASED";
      case BE_POSITION_PARTIALLY_CLOSED: return "POSITION_PARTIALLY_CLOSED";
      case BE_POSITION_CLOSED:           return "POSITION_CLOSED";
      case BE_SL_UPDATED:                return "SL_UPDATED";
      case BE_TP_UPDATED:                return "TP_UPDATED";
      case BE_STOP_LOSS_TRIGGERED:       return "STOP_LOSS_TRIGGERED";
      case BE_TAKE_PROFIT_TRIGGERED:     return "TAKE_PROFIT_TRIGGERED";
      case BE_PENDING_ORDER_CREATED:     return "PENDING_ORDER_CREATED";
      case BE_PENDING_ORDER_UPDATED:     return "PENDING_ORDER_UPDATED";
      case BE_PENDING_ORDER_CANCELLED:   return "PENDING_ORDER_CANCELLED";
      case BE_PENDING_ORDER_FILLED:      return "PENDING_ORDER_FILLED";
      default:                           return "UNKNOWN";
   }
}

#endif
