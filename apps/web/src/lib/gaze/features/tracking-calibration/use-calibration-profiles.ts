import { useEffect, useRef, useState } from "react"
import { screenProfileModel } from "../eye-tracking/calibration-profile-adapter"
import {
  checkCalibrationCompatibility,
  deleteCalibrationProfile,
  readCalibrationProfiles,
  saveCalibrationProfile,
  selectCalibrationProfile,
} from "./calibration-profiles"
import type {
  ModelContextBinding,
  ProfileControlsController,
  UseSavedCalibrationOptions,
} from "./use-calibration-profiles.types"
import type { CalibrationProfile } from "./calibration-profiles.types"

export function useSavedCalibration(
  options: UseSavedCalibrationOptions
): ProfileControlsController {
  const [library, setLibrary] = useState(readCalibrationProfiles)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const callbacks = useRef(options)
  callbacks.current = options
  const restoredContext = useRef("")
  const selectedModel = useRef<object | null>(null)
  const modelContext = useRef<ModelContextBinding | null>(null)
  const { context, payload, ready, disabled } = options
  const contextKey = JSON.stringify(context)
  const canLoad = ready && !!context && !disabled
  const canSave = canLoad && !!payload
  const profiles = library.profiles.filter(
    (profile) => profile.context.tracker === context?.tracker
  )
  function load(id: string): void {
    const current = callbacks.current
    if (!current.context || !current.ready || current.disabled) {
      return
    }
    try {
      const profile = readCalibrationProfiles().profiles.find(
        (item) => item.id === id
      )
      if (!profile) {
        throw new Error("This profile is no longer available.")
      }
      const compatibility = checkCalibrationCompatibility(
        profile.context,
        current.context
      )
      if (!compatibility.compatible) {
        throw new Error(compatibility.reason)
      }
      const issue = current.loadIssue?.(profile.payload)
      if (issue) {
        throw new Error(issue)
      }
      const selectedLibrary = selectCalibrationProfile(profile.id)
      current.onLoaded(
        profile.payload,
        profile.offset,
        profile.alignment ?? null
      )
      selectedModel.current = profile.payload.model
      setSelectedId(profile.id)
      setLibrary(selectedLibrary)
      setMessage(compatibility.reason)
      setError("")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load profile."
      )
    }
  }
  useEffect(() => {
    if (!ready && !payload) {
      restoredContext.current = ""
      modelContext.current = null
    }
  }, [ready, payload])
  useEffect(() => {
    if (disabled || !payload || !context) {
      return
    }
    const binding = modelContext.current
    if (!binding || binding.model !== payload.model) {
      modelContext.current = { model: payload.model, context }
      return
    }
    const compatibility = checkCalibrationCompatibility(
      binding.context,
      context
    )
    if (!compatibility.compatible) {
      restoredContext.current = ""
      callbacks.current.onIncompatible?.()
      setMessage(compatibility.reason)
    }
  }, [contextKey, context, payload, disabled])
  useEffect(() => {
    if (!canLoad || restoredContext.current === contextKey) {
      return
    }
    const current = callbacks.current
    if (current.payload || !current.context) {
      return
    }
    restoredContext.current = contextKey
    const compatible = library.profiles.filter(
      (profile) =>
        checkCalibrationCompatibility(profile.context, current.context!)
          .compatible
    )
    const eligible = compatible.filter(
      (profile) => !current.loadIssue?.(profile.payload)
    )
    const saved =
      eligible.find((profile) => profile.id === library.selectedId) ??
      eligible.at(-1)
    if (saved) {
      load(saved.id)
    } else if (compatible.length) {
      const previous =
        compatible.find((profile) => profile.id === library.selectedId) ??
        compatible.at(-1)!
      setMessage(current.loadIssue?.(previous.payload) ?? "")
    }
  }, [canLoad, contextKey, library])
  useEffect(() => {
    const currentModel = payload?.model ?? null
    if (selectedModel.current === currentModel) {
      return
    }
    if (!currentModel && !selectedId) {
      return
    }
    setSelectedId(null)
    setMessage("")
    setError("")
    selectedModel.current = null
  }, [payload?.model, selectedId])
  function save(name: string, profileId?: string): boolean {
    if (!canSave || !payload || !context) {
      return false
    }
    try {
      const savedPayload = { ...payload, model: screenProfileModel(payload.model) }
      const profile: CalibrationProfile = {
        id: profileId ?? crypto.randomUUID(),
        name,
        updatedAt: new Date().toISOString(),
        context,
        payload: savedPayload,
        offset: options.offset,
        alignment: options.alignment ?? null,
      }
      saveCalibrationProfile(profile)
      selectedModel.current = payload.model
      setSelectedId(profile.id)
      setLibrary(readCalibrationProfiles())
      setError("")
      setMessage("Saved on this device")
      return true
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save profile."
      )
      return false
    }
  }
  function remove(): void {
    if (disabled || !selectedId) {
      return
    }
    try {
      deleteCalibrationProfile(selectedId)
      setLibrary(readCalibrationProfiles())
      setSelectedId(null)
      setMessage("Profile removed · current calibration kept")
      setError("")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete profile."
      )
    }
  }
  return {
    profiles,
    selectedId,
    error,
    message,
    disabled,
    canLoad,
    canSave,
    load,
    save,
    clearError: () => setError(""),
    remove,
  }
}
