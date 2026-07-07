/**
 * M8 party P3 — lockstep harness + contract (design §§1,7). Pure TS, dependency-free
 * beyond the engine `step()` + `stateHash`, so a future networked client wraps
 * `LockstepClient` directly. Not re-exported from the main `@/engine` barrel yet — the
 * solo public surface is unchanged; the P4 client imports from here when it lands.
 */

export {
  SUB_STEPS_PER_TURN,
  TURN_MS,
  INPUT_DELAY_TURNS,
  executeTurn,
  runTurns,
  LockstepClient,
  type TurnLanes,
  type TurnMessage,
} from "@/engine/lockstep/turnLoop";
export { stateHash, HASH_SEED } from "@/engine/lockstep/stateHash";
