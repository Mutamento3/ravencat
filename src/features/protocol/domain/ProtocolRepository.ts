/** 协议空间实体与持久化端口。 */
export interface Protocol {
  id: string;
  aiAssistantId: string;
  content: string;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProtocolInput {
  aiAssistantId: string;
  content: string;
  summary?: string | null;
}

export interface UpdateProtocolInput {
  content?: string;
  summary?: string | null;
}

export interface IProtocolRepository {
  getByAI(aiAssistantId: string): Promise<Protocol[]>;
  getById(id: string): Promise<Protocol | null>;
  getPromptText(aiAssistantId: string): Promise<string>;
  search(aiAssistantId: string, keyword: string): Promise<Protocol[]>;
  insert(protocol: CreateProtocolInput): Promise<Protocol>;
  update(id: string, updates: UpdateProtocolInput): Promise<Partial<Protocol> & Pick<Protocol, 'id' | 'updatedAt'>>;
  delete(id: string): Promise<boolean>;
}
