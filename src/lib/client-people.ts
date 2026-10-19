export const PERSON_FUNCTIONS = ["executa", "monitora", "acompanha", "decide"] as const;

export type PersonFunction = (typeof PERSON_FUNCTIONS)[number];
