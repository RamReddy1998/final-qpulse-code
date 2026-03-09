import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiProvider, AiProviderConfig } from '../ai.interface';
import { AiExplanationResponse } from '../../../types';
import logger from '../../../config/logger';

export class GoogleProvider implements AiProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(config: AiProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Google API key is required for GoogleProvider');
    }

    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-1.5-pro';
    this.maxRetries = config.maxRetries || 3;
    this.timeoutMs = config.timeoutMs || 30000;

    logger.info('GoogleProvider initialized', { model: this.model });
  }

  getProviderName(): string {
    return 'google';
  }

  async generateExplanation(
    questionText: string,
    options: Record<string, string>,
    correctAnswer: string,
    userAnswer?: string
  ): Promise<AiExplanationResponse> {
    const prompt = this.buildExplanationPrompt(questionText, options, correctAnswer, userAnswer);
    return this.executeAiCall(prompt) as Promise<AiExplanationResponse>;
  }

  async generateHint(
    questionText: string,
    options: Record<string, string>,
    correctAnswer: string
  ): Promise<{ hints: string[]; tips: string[]; solvingStrategy: string }> {
    const prompt = this.buildHintPrompt(questionText, options, correctAnswer);
    return this.executeAiCall(prompt) as Promise<{ hints: string[]; tips: string[]; solvingStrategy: string }>;
  }

  private async executeAiCall(prompt: string): Promise<any> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`GoogleProvider: attempt ${attempt}/${this.maxRetries}`);
        const model = this.genAI.getGenerativeModel({ model: this.model });
        const result = await Promise.race([
          model.generateContent(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI request timeout')), this.timeoutMs)
          ),
        ]);
        const response = (result as any).response;
        const text = response.text();
        let jsonStr = text;
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        return JSON.parse(jsonStr);
      } catch (error) {
        logger.error(`GoogleProvider attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        if (attempt === this.maxRetries) throw error;
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private buildExplanationPrompt(
    questionText: string,
    options: Record<string, string>,
    correctAnswer: string,
    userAnswer?: string
  ): string {
    const optionsText = Object.entries(options)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    return `You are an expert exam preparation tutor. Analyze this question and provide a detailed explanation.
    
QUESTION:
${questionText}

OPTIONS:
${optionsText}

CORRECT ANSWER: ${correctAnswer}
${userAnswer ? `USER'S ANSWER: ${userAnswer}` : ''}

IMPORTANT: Your explanations must be DYNAMIC and SPECIFIC. 
For "wrongOptionsExplanation", do not use generic phrases. Explain exactly why that specific option is incorrect OR how it's designed to distract the student in this specific context.

Respond ONLY with valid JSON. No markdown.
{
  "stepByStep": "Step-by-step logic to arrive at the correct answer",
  "conceptual": "The core concept or theory behind the question",
  "examOriented": "Exam tips, common variations, and keyword indicators",
  "correctAnswerExplanation": "Comprehensive reason why ${correctAnswer} is the absolute best choice among all options",
  "wrongOptionsExplanation": {
    "A": "Specific reason why this distractor is wrong",
    "B": "Specific reason why this distractor is wrong",
    "C": "Specific reason why this distractor is wrong",
    "D": "Specific reason why this distractor is wrong"
  },
  "examTrap": "The specific trap or common misconception in this question",
  "memoryTrick": "A mnemonic or shortcut to remember this specific fact/concept"
}`;
  }

  private buildHintPrompt(
    questionText: string,
    options: Record<string, string>,
    correctAnswer: string
  ): string {
    const optionsText = Object.entries(options)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    return `You are an expert exam preparation tutor. Provide a HINT to help a student solve the following question.

CRITICAL RULES:
1. NEVER reveal the correct answer (letter or text).
2. NEVER say "The answer is not A" or "Focus on B".
3. Provide conceptual guidance and elimination strategies only.
4. If a student is stuck, give them a "thinking prompt" to trigger their memory.

QUESTION:
${questionText}

OPTIONS:
${optionsText}

Respond ONLY with valid JSON.
{
  "hints": ["Hint 1 focusing on the core concept", "Hint 2 triggering a specific memory or rule"],
  "tips": ["One or two exam tips related to this type of question"],
  "solvingStrategy": "A general logical strategy to eliminate wrong options and find the right one"
}`;
  }
}
