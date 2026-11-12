export interface JournalEntry {
    msgIdx: number;
    includeContent?: boolean; // If content of the message entry should be included in the summary to LITE model
    calculatedDelta: number;
    maxDelta: number;
    note: string;
}
