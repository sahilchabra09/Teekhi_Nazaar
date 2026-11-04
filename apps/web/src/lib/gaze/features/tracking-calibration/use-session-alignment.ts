import { useState } from "react"
import type {
  SessionAlignment,
  SessionAlignmentState,
} from "./session-alignment.types"
/** Session correction is distinct from the eye/head model and applied exactly once. */
export function useSessionAlignment(model: object | null) {
  const [state, setState] = useState<SessionAlignmentState>({
    model,
    alignment: null,
  })
  if (state.model !== model) {
    setState({ model, alignment: null })
  }
  const alignment = state.model === model ? state.alignment : null
  function setAlignment(
    value: SessionAlignment | null,
    base: object | null = model
  ): void {
    setState({ model: base, alignment: value })
  }
  return { alignment, setAlignment }
}
