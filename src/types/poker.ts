export type Suit = "s" | "h" | "d" | "c";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export type Card = `${Rank}${Suit}`;

export type PokerStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export type PokerActionType = "fold" | "check" | "call" | "bet" | "raise";

export interface LegalAction {
  type: PokerActionType;
  amount?: number;
  min?: number;
  max?: number;
}

export interface PublicPlayerView {
  id: string;
  displayName: string;
  seat: number;
  stack: number;
  status: "active" | "folded" | "all-in" | "waiting";
  committedThisStreet: number;
  isBot: boolean;
  hasAgent: boolean;
}

export interface HandActionEvent {
  sequence: number;
  street: PokerStreet;
  playerId: string;
  playerName: string;
  action: PokerActionType | "small-blind" | "big-blind" | "deal";
  amount?: number;
}

export interface PokerSituation {
  gameId: string;
  handNumber: number;
  stateVersion: number;
  street: PokerStreet;
  isYourTurn: boolean;
  currentActorId: string | null;
  yourPlayerId: string;
  yourSeat: number;
  yourCards: Card[];
  yourStack: number;
  board: Card[];
  pot: number;
  currentBet: number;
  toCall: number;
  dealerSeat: number;
  legalActions: LegalAction[];
  players: PublicPlayerView[];
  recentActions: HandActionEvent[];
  handResult: HandResult | null;
}

export interface HandResult {
  reason: "fold" | "showdown";
  winners: Array<{
    playerId: string;
    playerName: string;
    amount: number;
  }>;
}

export interface PokerActionIntent {
  action: PokerActionType;
  amount?: number;
}

export interface AgentSuggestion {
  handNumber: number;
  stateVersion: number;
  action: PokerActionType;
  amount?: number;
  confidence?: number;
}

export interface RawPlayerState extends PublicPlayerView {
  holeCards: Card[];
  cardsRevealed: boolean;
}

export interface RawGameState {
  gameId: string;
  handNumber: number;
  stateVersion: number;
  street: PokerStreet;
  board: Card[];
  deck: Card[];
  players: RawPlayerState[];
}

export interface SafePlayerProjection extends PublicPlayerView {
  holeCards?: Card[];
}

export interface SafeGameProjection {
  gameId: string;
  handNumber: number;
  stateVersion: number;
  street: PokerStreet;
  board: Card[];
  players: SafePlayerProjection[];
}
