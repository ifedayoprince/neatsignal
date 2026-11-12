export interface JournalEntry {
    msgIdx: number;
    includeContent?: boolean; // If content of the message entry should be included in the summary to LITE model
    calculatedDelta: number;
    maxDelta: number;
    note: string;
}

export interface Score {
    totalObservations: number;
    validObservations: number;
    calculatedFriction: number;
    maxFriction: number;
    frictionScore: number;
    recommendations?: string;
}