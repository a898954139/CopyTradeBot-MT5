//+------------------------------------------------------------------+
//| RetryQueue.mqh - Lightweight retry queue with backoff            |
//+------------------------------------------------------------------+
#ifndef RETRY_QUEUE_MQH
#define RETRY_QUEUE_MQH

#include "Enums.mqh"
#include "Logger.mqh"
#include "WebhookClient.mqh"

//--- Maximum items in retry queue
#define MAX_RETRY_ITEMS 100
//--- Maximum retry attempts before dead-lettering
#define MAX_RETRY_ATTEMPTS 5

//+------------------------------------------------------------------+
//| Single retry queue entry                                          |
//+------------------------------------------------------------------+
struct RetryItem
{
   string   json_body;
   string   idempotency_key;
   int      attempt;
   datetime next_retry_at;
   bool     active;
};

//+------------------------------------------------------------------+
//| Backoff schedule (seconds):                                       |
//|   Attempt 1: immediate (already tried once in-line)               |
//|   Attempt 2: 5s                                                   |
//|   Attempt 3: 15s                                                  |
//|   Attempt 4: 60s                                                  |
//|   Attempt 5: 60s                                                  |
//|   After 5:   dead-letter                                          |
//+------------------------------------------------------------------+
class CRetryQueue
{
private:
   RetryItem  m_queue[MAX_RETRY_ITEMS];
   int        m_count;
   CWebhookClient *m_client;

public:
   CRetryQueue() : m_count(0), m_client(NULL) {}

   void Init(CWebhookClient *client)
   {
      m_client = client;
      m_count = 0;
      for(int i = 0; i < MAX_RETRY_ITEMS; i++)
         m_queue[i].active = false;
   }

   //--- Enqueue a failed payload for retry
   bool Enqueue(string json_body, string idempotency_key, int attempt)
   {
      if(attempt >= MAX_RETRY_ATTEMPTS)
      {
         CLogger::LogDeadLetter(idempotency_key, attempt);
         WriteDeadLetter(json_body, idempotency_key);
         return false;
      }

      int slot = FindFreeSlot();
      if(slot < 0)
      {
         CLogger::Error("RetryQueue", "Queue full, dropping: " + idempotency_key);
         return false;
      }

      m_queue[slot].json_body       = json_body;
      m_queue[slot].idempotency_key = idempotency_key;
      m_queue[slot].attempt         = attempt;
      m_queue[slot].next_retry_at   = TimeCurrent() + GetBackoffSeconds(attempt);
      m_queue[slot].active          = true;
      m_count++;

      CLogger::LogRetryQueued(idempotency_key, attempt);
      return true;
   }

   //--- Process pending retries (called from OnTimer)
   void ProcessRetries()
   {
      if(m_client == NULL || m_count == 0)
         return;

      datetime now = TimeCurrent();

      for(int i = 0; i < MAX_RETRY_ITEMS; i++)
      {
         if(!m_queue[i].active)
            continue;

         if(now < m_queue[i].next_retry_at)
            continue;

         // Attempt retry
         ENUM_DELIVERY_STATUS status = m_client.Send(
            m_queue[i].json_body,
            m_queue[i].idempotency_key
         );

         if(status == DS_SUCCESS)
         {
            CLogger::LogRetrySuccess(m_queue[i].idempotency_key,
                                     m_queue[i].attempt);
            m_queue[i].active = false;
            m_count--;
         }
         else if(status == DS_RETRYABLE_FAILURE)
         {
            // Re-enqueue with incremented attempt
            int next_attempt = m_queue[i].attempt + 1;
            if(next_attempt >= MAX_RETRY_ATTEMPTS)
            {
               CLogger::LogDeadLetter(m_queue[i].idempotency_key, next_attempt);
               WriteDeadLetter(m_queue[i].json_body, m_queue[i].idempotency_key);
               m_queue[i].active = false;
               m_count--;
            }
            else
            {
               m_queue[i].attempt = next_attempt;
               m_queue[i].next_retry_at = TimeCurrent() + GetBackoffSeconds(next_attempt);
            }
         }
         else
         {
            // Non-retryable: dead-letter immediately
            CLogger::LogDeadLetter(m_queue[i].idempotency_key,
                                   m_queue[i].attempt);
            WriteDeadLetter(m_queue[i].json_body, m_queue[i].idempotency_key);
            m_queue[i].active = false;
            m_count--;
         }
      }
   }

   //--- Get current queue depth
   int Count() const { return m_count; }

private:
   //--- Find an available slot in the queue
   int FindFreeSlot()
   {
      for(int i = 0; i < MAX_RETRY_ITEMS; i++)
      {
         if(!m_queue[i].active)
            return i;
      }
      return -1;
   }

   //--- Get backoff delay in seconds for a given attempt number
   static int GetBackoffSeconds(int attempt)
   {
      switch(attempt)
      {
         case 1:  return 5;
         case 2:  return 15;
         case 3:  return 60;
         case 4:  return 60;
         default: return 60;
      }
   }

   //--- Write dead-lettered payload to file for manual inspection
   static void WriteDeadLetter(string json_body, string idempotency_key)
   {
      string filename = "dead_letters/" + idempotency_key + ".json";
      // Replace pipe characters in filename
      StringReplace(filename, "|", "_");

      int handle = FileOpen(filename, FILE_WRITE | FILE_TXT | FILE_COMMON);
      if(handle != INVALID_HANDLE)
      {
         FileWriteString(handle, json_body);
         FileClose(handle);
         CLogger::Info("RetryQueue", "Dead letter written: " + filename);
      }
      else
      {
         CLogger::Error("RetryQueue", "Failed to write dead letter: " + filename);
      }
   }
};

#endif
