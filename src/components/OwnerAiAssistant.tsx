import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bot, MessageSquarePlus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type {
  AssistantConversationDTO,
  AssistantMessageDTO,
  RestaurantDTO,
} from '../shared/types.ts';

interface OwnerAiAssistantProps {
  restaurant: RestaurantDTO;
}

const SUGGESTED_QUESTIONS = [
  "What is today's revenue and order count?",
  'Show me our top selling and low performing dishes',
  'Are there any delayed orders or low inventory ingredients right now?',
  'Analyze peak business hours and summarize recent customer feedback',
];

export const OwnerAiAssistant: React.FC<OwnerAiAssistantProps> = ({ restaurant }) => {
  const [conversations, setConversations] = useState<AssistantConversationDTO[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AssistantMessageDTO[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const list = await apiFetch<AssistantConversationDTO[]>(
        `/api/ai/assistant/conversations?restaurantId=${restaurant.id}`
      );
      setConversations(list);
      setActiveConvId((curr) => curr ?? (list[0]?.id ?? null));
    } catch {
      // Ignore initial empty state
    }
  }, [restaurant.id]);

  const loadMessages = useCallback(async (convId: number) => {
    try {
      const msgs = await apiFetch<AssistantMessageDTO[]>(
        `/api/ai/assistant/conversations/${convId}/messages`
      );
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    setActiveConvId(null);
    setMessages([]);
    loadConversations();
  }, [restaurant.id, loadConversations]);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId, loadMessages]);

  const handleSend = async (promptText?: string) => {
    const query = (promptText ?? input).trim();
    if (!query || sending) return;
    if (!promptText) setInput('');
    setSending(true);
    setError('');

    const optimisticUser: AssistantMessageDTO = {
      id: Date.now(),
      conversationId: activeConvId || 0,
      role: 'user',
      content: query,
      toolsUsed: [],
      chartData: null,
      dateRangeLabel: '',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const res = await apiFetch<{ conversationId: number; message: AssistantMessageDTO }>(
        '/api/ai/assistant/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            restaurantId: restaurant.id,
            conversationId: activeConvId || undefined,
            message: query,
          }),
        }
      );
      setActiveConvId(res.conversationId);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        { ...optimisticUser, conversationId: res.conversationId },
        res.message,
      ]);
      loadConversations();
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      if (!promptText) setInput(query);
      setError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setSending(false);
    }
  };

  const handleClearConversation = async () => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    try {
      await apiFetch(`/api/ai/assistant/conversations/${activeConvId}`, { method: 'DELETE' });
      setActiveConvId(null);
      setMessages([]);
      loadConversations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to clear conversation');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-orange-500" />
            AI Restaurant Operations Assistant
          </h1>
          <p className="text-xs text-stone-400 mt-0.5">
            Tenant-scoped BI assistant grounded in live {restaurant.name} orders, revenue, stock, and reviews.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveConvId(null);
              setMessages([]);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-700 px-3 py-2 text-xs font-medium text-stone-200 hover:bg-stone-800"
          >
            <MessageSquarePlus className="w-3.5 h-3.5 text-orange-400" />
            New Chat
          </button>
          <button
            type="button"
            onClick={handleClearConversation}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-700 px-3 py-2 text-xs font-medium text-stone-300 hover:bg-red-950/50 hover:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Conversation History Sidebar */}
        <div className="lg:col-span-3 rounded-2xl bg-[#1B1613] border border-stone-800 p-4 space-y-2">
          <p className="text-xs font-semibold text-stone-400">Recent Sessions</p>
          {conversations.length === 0 ? (
            <p className="text-xs text-stone-500 py-2">No saved conversations yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveConvId(c.id)}
                  className={`w-full text-left rounded-xl px-3 py-2 text-xs transition-colors truncate ${
                    activeConvId === c.id
                      ? 'bg-orange-600 text-white font-semibold'
                      : 'bg-[#120F0D] text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Chat Thread */}
        <div className="lg:col-span-9 rounded-2xl bg-[#1B1613] border border-stone-800 flex flex-col h-[560px]">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-4">
                <Sparkles className="w-8 h-8 text-orange-500" />
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Ask anything about {restaurant.name}
                  </h2>
                  <p className="text-xs text-stone-400 mt-1 max-w-md">
                    Uses structured analytical tool calls to inspect revenue, top dishes, delayed
                    tickets, low inventory, and guest ratings in real time.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSend(q)}
                      className="text-left rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-xs text-stone-300 hover:border-orange-500"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 space-y-3 ${
                      m.role === 'user'
                        ? 'bg-orange-600 text-white'
                        : 'bg-[#120F0D] border border-stone-800 text-stone-200'
                    }`}
                  >
                    {m.role === 'assistant' && (m.dateRangeLabel || m.toolsUsed?.length > 0) && (
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-stone-400 border-b border-stone-800 pb-2">
                        {m.dateRangeLabel && (
                          <span className="text-orange-400 font-semibold">{m.dateRangeLabel}</span>
                        )}
                        {m.toolsUsed?.length > 0 && (
                          <span className="font-mono">Tools: {m.toolsUsed.join(', ')}</span>
                        )}
                      </div>
                    )}

                    <div className="text-xs leading-relaxed whitespace-pre-wrap">{m.content}</div>

                    {m.chartData && m.chartData.data?.length > 0 && (
                      <div className="rounded-xl bg-[#1B1613] border border-stone-800 p-3 pt-4">
                        <p className="text-[11px] font-semibold text-stone-300 mb-2">
                          {m.chartData.title}
                        </p>
                        <div className="h-44 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            {m.chartData.chartType === 'line' ? (
                              <LineChart data={m.chartData.data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                                <XAxis dataKey={m.chartData.xKey} stroke="#A8A29E" fontSize={10} />
                                <YAxis stroke="#A8A29E" fontSize={10} />
                                <Tooltip />
                                <Line
                                  type="monotone"
                                  dataKey={m.chartData.yKey}
                                  stroke="#F97316"
                                  strokeWidth={2}
                                />
                              </LineChart>
                            ) : (
                              <BarChart data={m.chartData.data}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                                <XAxis dataKey={m.chartData.xKey} stroke="#A8A29E" fontSize={10} />
                                <YAxis stroke="#A8A29E" fontSize={10} />
                                <Tooltip />
                                <Bar
                                  dataKey={m.chartData.yKey}
                                  fill="#EA580C"
                                  radius={[4, 4, 0, 0]}
                                />
                              </BarChart>
                            )}
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-[#120F0D] border border-stone-800 px-4 py-3 text-xs text-stone-400 inline-flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-500" />
                  Querying restaurant metrics and composing insights...
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-xl bg-red-950/60 border border-red-800 px-3.5 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-4 border-t border-stone-800 flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about sales, delayed orders, top dishes, low stock, or guest reviews..."
              className="flex-1 rounded-xl bg-[#120F0D] border border-stone-800 px-4 py-2.5 text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[42px]"
            >
              <Send className="w-4 h-4" />
              Ask
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
