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
  /** Final total chips committed on this street, never an increment. */
  minTotal?: number;
  /** Final total chips committed on this street, never an increment. */
  maxTotal?: number;
}

export interface PublicPlayerView {
  id: string;
  displayName: string;
  seat: number;
  stack: number;
  status: "active" | "folded" | "all-in" | "waiting" | "out";
  committedThisStreet: number;
  isBot: boolean;
  hasAgent: boolean;
  revealedCards?: Card[];
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
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  legalActions: LegalAction[];
  players: PublicPlayerView[];
  recentActions: HandActionEvent[];
  handResult: HandResult | null;
  gameResult: GameResult | null;
}

export interface HandResult {
  reason: "fold" | "showdown";
  winners: Array<{
    playerId: string;
    playerName: string;
    amount: number;
  }>;
}

export type GameResult =
  | {
      outcome: "won";
      reason: "last-player-standing";
    }
  | {
      outcome: "lost";
      reason: "human-eliminated";
    };

export interface PokerActionIntent {
  action: PokerActionType;
  /** For bet or raise: final total chips committed on this street. */
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

export type RoomPhase = "waiting" | "active" | "complete";
export type RoomViewerStatus = "seated" | "eliminated";

export interface RoomViewer {
  playerId: string;
  seat: number;
  displayName: string;
  isOwner: boolean;
  status: RoomViewerStatus;
}

export interface RoomSeat {
  playerId: string;
  displayName: string;
  seat: number;
  isBot: boolean;
  isYou: boolean;
  status: PublicPlayerView["status"];
  stack: number | null;
}

export interface RoomResult {
  reason: "last-player-standing" | "all-humans-eliminated";
  winnerPlayerId: string | null;
}

interface RoomSnapshotBase {
  gameId: string;
  roomCode: string;
  revision: number;
  viewer: RoomViewer;
  seats: RoomSeat[];
}

export interface WaitingRoomSnapshot extends RoomSnapshotBase {
  phase: "waiting";
  canStart: boolean;
}

export interface PlayingRoomSnapshot extends RoomSnapshotBase {
  phase: "active" | "complete";
  situation: PokerSituation;
  result: RoomResult | null;
}

export type RoomSnapshot = WaitingRoomSnapshot | PlayingRoomSnapshot;

export interface RoomOperationResult {
  room: RoomSnapshot;
  operation: {
    id: string;
    status: "accepted" | "replayed";
    resultRevision: number;
  };
}
