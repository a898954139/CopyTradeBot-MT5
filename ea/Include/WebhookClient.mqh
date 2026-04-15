//+------------------------------------------------------------------+
//| WebhookClient.mqh - HMAC-signed webhook POST to relay            |
//+------------------------------------------------------------------+
#ifndef WEBHOOK_CLIENT_MQH
#define WEBHOOK_CLIENT_MQH

#include "Enums.mqh"
#include "Logger.mqh"

//+------------------------------------------------------------------+
//| HTTP response classification:                                     |
//| 2xx          → SUCCESS                                           |
//| 408,429,5xx  → RETRYABLE                                        |
//| other 4xx    → NON_RETRYABLE                                    |
//+------------------------------------------------------------------+
class CWebhookClient
{
private:
   string m_url;
   string m_secret;
   int    m_timeout_ms;

public:
   void Init(string url, string secret, int timeout_ms = 5000)
   {
      m_url        = url;
      m_secret     = secret;
      m_timeout_ms = timeout_ms;
   }

   //--- Send a JSON payload to the relay endpoint
   //--- Returns delivery status
   ENUM_DELIVERY_STATUS Send(string json_body, string idempotency_key)
   {
      if(m_url == "")
      {
         CLogger::Error("WebhookClient", "URL not configured");
         return DS_NON_RETRYABLE_FAILURE;
      }

      // Build HMAC signature
      string signature = ComputeHMAC(json_body);

      // Prepare headers
      string headers = "Content-Type: application/json\r\n"
                       "X-Source: mt5-ea\r\n"
                       "X-Signature: " + signature + "\r\n"
                       "X-Idempotency-Key: " + idempotency_key + "\r\n";

      // Convert body to char array
      char post_data[];
      char result_data[];
      string result_headers;

      StringToCharArray(json_body, post_data, 0, WHOLE_ARRAY, CP_UTF8);

      // Remove null terminator that StringToCharArray adds
      int data_size = ArraySize(post_data);
      if(data_size > 0 && post_data[data_size - 1] == 0)
         ArrayResize(post_data, data_size - 1);

      ResetLastError();
      int http_code = WebRequest("POST", m_url, headers, m_timeout_ms,
                                  post_data, result_data, result_headers);

      if(http_code == -1)
      {
         int err = GetLastError();
         CLogger::Error("WebhookClient",
                        StringFormat("WebRequest failed: error=%d (check URL whitelist in Tools>Options>Expert Advisors)",
                                     err));
         return DS_RETRYABLE_FAILURE;
      }

      ENUM_DELIVERY_STATUS status = ClassifyResponse(http_code);

      CLogger::LogDeliveryAttempt(idempotency_key, http_code, status);

      return status;
   }

private:
   //--- Classify HTTP response code into delivery status
   static ENUM_DELIVERY_STATUS ClassifyResponse(int code)
   {
      // 2xx = success
      if(code >= 200 && code < 300)
         return DS_SUCCESS;

      // Retryable errors
      if(code == 408 || code == 429 || code >= 500)
         return DS_RETRYABLE_FAILURE;

      // All other 4xx = non-retryable
      return DS_NON_RETRYABLE_FAILURE;
   }

   //--- Compute HMAC-SHA256 signature
   //--- MQL5 CryptEncode supports CRYPT_HASH_SHA256
   string ComputeHMAC(string message)
   {
      uchar key_bytes[];
      uchar msg_bytes[];
      uchar hmac_result[];

      StringToCharArray(m_secret, key_bytes, 0, WHOLE_ARRAY, CP_UTF8);
      StringToCharArray(message, msg_bytes, 0, WHOLE_ARRAY, CP_UTF8);

      // Remove null terminators
      int key_size = ArraySize(key_bytes);
      if(key_size > 0 && key_bytes[key_size - 1] == 0)
         ArrayResize(key_bytes, key_size - 1);

      int msg_size = ArraySize(msg_bytes);
      if(msg_size > 0 && msg_bytes[msg_size - 1] == 0)
         ArrayResize(msg_bytes, msg_size - 1);

      if(!CryptEncode(CRYPT_HASH_SHA256, msg_bytes, key_bytes, hmac_result))
      {
         CLogger::Error("WebhookClient", "HMAC computation failed");
         return "";
      }

      // Convert to hex string
      string hex = "";
      int size = ArraySize(hmac_result);
      for(int i = 0; i < size; i++)
      {
         hex += StringFormat("%02x", hmac_result[i]);
      }
      return hex;
   }
};

#endif
