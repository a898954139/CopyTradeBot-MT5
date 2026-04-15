//+------------------------------------------------------------------+
//| Logger.mqh - Structured logging with trace context               |
//+------------------------------------------------------------------+
#ifndef LOGGER_MQH
#define LOGGER_MQH

#include "Enums.mqh"

//+------------------------------------------------------------------+
//| Log levels and structured output                                  |
//+------------------------------------------------------------------+
class CLogger
{
public:
   static void Info(string module, string message)
   {
      Print("[INFO] [", module, "] ", message);
   }

   static void Warn(string module, string message)
   {
      Print("[WARN] [", module, "] ", message);
   }

   static void Error(string module, string message)
   {
      Print("[ERROR] [", module, "] ", message);
   }

   //--- Log transaction receipt
   static void LogTransactionReceived(ENUM_TRADE_TRANSACTION_TYPE type,
                                      ulong order, ulong deal, ulong position)
   {
      Info("TransactionListener",
           StringFormat("Received: type=%s order=%I64u deal=%I64u pos=%I64u",
                        EnumToString(type), order, deal, position));
   }

   //--- Log classification result
   static void LogClassification(ENUM_BUSINESS_EVENT event,
                                 string symbol, string idempotency_key)
   {
      Info("EventClassifier",
           StringFormat("Classified: event=%s symbol=%s key=%s",
                        BusinessEventToString(event), symbol, idempotency_key));
   }

   //--- Log delivery attempt
   static void LogDeliveryAttempt(string idempotency_key, int http_code,
                                  ENUM_DELIVERY_STATUS status)
   {
      string status_str;
      switch(status)
      {
         case DS_SUCCESS:              status_str = "SUCCESS"; break;
         case DS_RETRYABLE_FAILURE:    status_str = "RETRYABLE"; break;
         case DS_NON_RETRYABLE_FAILURE: status_str = "NON_RETRYABLE"; break;
         default:                      status_str = "PENDING"; break;
      }
      Info("WebhookClient",
           StringFormat("Delivery: key=%s http=%d status=%s",
                        idempotency_key, http_code, status_str));
   }

   //--- Log retry queue action
   static void LogRetryQueued(string idempotency_key, int attempt)
   {
      Warn("RetryQueue",
           StringFormat("Queued for retry: key=%s attempt=%d",
                        idempotency_key, attempt));
   }

   static void LogRetrySuccess(string idempotency_key, int attempt)
   {
      Info("RetryQueue",
           StringFormat("Retry succeeded: key=%s attempt=%d",
                        idempotency_key, attempt));
   }

   static void LogDeadLetter(string idempotency_key, int attempts)
   {
      Error("RetryQueue",
            StringFormat("Dead-lettered after %d attempts: key=%s",
                         attempts, idempotency_key));
   }
};

#endif
