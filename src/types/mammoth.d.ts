declare module 'mammoth' {
    export interface MammothMessage {
        type: string;
        message: string;
    }

    export interface MammothTextResult {
        value: string;
        messages: MammothMessage[];
    }

    export function extractRawText(
        input: { buffer: Buffer } | { path: string }
    ): Promise<MammothTextResult>;
}
