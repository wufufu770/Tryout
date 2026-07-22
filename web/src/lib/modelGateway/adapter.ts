import { api } from "@/api/client";

export interface IModelAdapter {
  name: string;
  chat(
    messages: { role: string; content: string }[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      onToken?: (t: string) => void;
    }
  ): Promise<{ content: string; tokensIn: number; tokensOut: number }>;
}

// 通过后端代理的适配器(所有 provider 统一走后端 /api/chat)
export class ProxyAdapter implements IModelAdapter {
  constructor(public name: string, private providerId: string) {}

  async chat(
    messages: { role: string; content: string }[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      onToken?: (t: string) => void;
    }
  ): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
    const result: any = await api.chat(
      this.providerId,
      { messages, ...options, stream: !!options?.onToken },
      options?.onToken
    );
    return {
      content: result.content,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }
}

export function getModelAdapter(
  providerId: string,
  providerName?: string
): IModelAdapter {
  return new ProxyAdapter(providerName || providerId, providerId);
}
