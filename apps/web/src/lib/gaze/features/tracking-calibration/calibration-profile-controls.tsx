import { Save, Trash2, X } from "lucide-react"
import { useState } from "react"
import { HelpTip } from "../eye-tracking/components/help-tip"
import {
  EyeActionIconStyles,
  EyeButtonStyles,
  EyeGuidanceRowStyles,
  EyeMutedStyles,
} from "../tracking-ui/control-styles"
import {
  SceneProfileControlsStyles,
  SceneProfileRowStyles,
} from "../tracking-ui/scene-styles"
import type {
  ProfileNameDraft,
  SharedProfileControlsProps,
} from "./calibration-profile-controls.types"
export function CalibrationProfileControls({
  controller,
  sceneLabels = true,
}: SharedProfileControlsProps) {
  const [draft, setDraft] = useState<ProfileNameDraft | null>(null)
  const selected = controller.profiles.find(
    (profile) => profile.id === controller.selectedId
  )
  function startSave() {
    controller.clearError?.()
    setDraft({ name: "", profileId: null })
  }
  function chooseSaveDestination(profileId: string) {
    controller.clearError?.()
    const profile = controller.profiles.find((item) => item.id === profileId)
    setDraft({
      name: profile?.name ?? "",
      profileId: profileId || null,
    })
  }
  return (
    <section
      className={`scene-profile-controls ${SceneProfileControlsStyles}`}
      aria-label={
        sceneLabels ? "Saved scene calibrations" : "Saved calibrations"
      }
    >
      <div className={`eye-guidance-row ${EyeGuidanceRowStyles}`}>
        <span>Calibration profile</span>
        <HelpTip
          label="Calibration profile help"
          text="Save opens a choice: create a named profile or replace an existing one with your current calibration. Choosing a save destination does not load its old mapping. Profiles and X/Y adjustments stay in this browser. Unverified calibrations stay unverified when saved or loaded."
        />
      </div>
      <div className={`scene-profile-row ${SceneProfileRowStyles}`}>
        <select
          aria-label={
            sceneLabels ? "Scene calibration profile" : "Calibration profile"
          }
          value={controller.selectedId ?? ""}
          disabled={
            !controller.canLoad || controller.profiles.length === 0 || !!draft
          }
          onChange={(event) => controller.load(event.target.value)}
        >
          <option value="" disabled>
            Choose profile
          </option>
          {controller.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label="Save calibration profile"
          data-tooltip="Save calibration"
          aria-expanded={!!draft}
          disabled={!controller.canSave || !!draft}
          onClick={startSave}
        >
          <Save size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
          aria-label="Delete calibration profile"
          data-tooltip="Delete profile"
          disabled={!selected || controller.disabled || !!draft}
          onClick={() => {
            if (
              selected &&
              window.confirm(`Delete “${selected.name}” from this browser?`)
            ) {
              controller.remove()
            }
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      {draft && (
        <form
          className="grid gap-2"
          aria-label={
            sceneLabels ? "Save scene calibration" : "Save calibration"
          }
          onSubmit={(event) => {
            event.preventDefault()
            if (controller.save(draft.name, draft.profileId ?? undefined)) {
              setDraft(null)
            }
          }}
        >
          <div className={`scene-profile-row ${SceneProfileRowStyles}`}>
            <select
              aria-label="Save calibration to"
              value={draft.profileId ?? ""}
              disabled={!controller.canSave}
              onChange={(event) => chooseSaveDestination(event.target.value)}
            >
              <option value="">New profile</option>
              {controller.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  Replace · {profile.name}
                </option>
              ))}
            </select>
          </div>
          {!draft.profileId && (
            <div className={`scene-profile-row ${SceneProfileRowStyles}`}>
              <input
                autoFocus
                aria-label="Calibration profile name"
                placeholder="Profile name"
                maxLength={60}
                value={draft.name}
                disabled={!controller.canSave}
                onChange={(event) => {
                  controller.clearError?.()
                  setDraft({ ...draft, name: event.target.value })
                }}
              />
            </div>
          )}
          <div className={`scene-profile-row ${SceneProfileRowStyles}`}>
            <button
              type="submit"
              className={`eye-button ${EyeButtonStyles} primary flex-1`}
              aria-label={
                draft.profileId
                  ? "Replace calibration profile"
                  : "Save new calibration profile"
              }
              disabled={!controller.canSave || !draft.name.trim()}
            >
              {draft.profileId ? "Replace profile" : "Save profile"}
            </button>
            <button
              type="button"
              className={`eye-button ${EyeButtonStyles} secondary eye-action-icon ${EyeActionIconStyles}`}
              aria-label="Cancel saving profile"
              data-tooltip="Cancel"
              onClick={() => {
                controller.clearError?.()
                setDraft(null)
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
      {controller.error && (
        <p className="eye-error" role="alert">
          {controller.error}
        </p>
      )}
      {!controller.error && controller.message && (
        <small className={`eye-muted ${EyeMutedStyles}`} role="status">
          {controller.message}
        </small>
      )}
    </section>
  )
}
