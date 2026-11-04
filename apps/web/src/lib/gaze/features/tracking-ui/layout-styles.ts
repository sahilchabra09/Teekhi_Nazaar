/** Static Tailwind primitives for layout presentation. */

export const EyeAppStyles = `
  [--ink:var(--pine)] [--dim:var(--pine-soft)] [--line:var(--border)] [--eye-action:var(--teal)]
  [--eye-pupil:var(--teal-light)] [--eye-sphere:var(--sky)] [--eye-ray:var(--honey)]
  [--eye-preview:var(--pine)] [--eye-preview-line:#48756d] [--eye-preview-text:white] [--eye-preview-muted:#c8e3d7]
  flex h-dvh flex-col overflow-y-auto bg-mist font-sans text-base text-pine scheme-light
  [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 [&_:focus-visible]:outline-honey
`

export const StatusLightStyles = `
  inline-block [flex-shrink:0] [width:6px] [height:6px]
  [background:var(--muted-foreground)] [border-radius:50%] [&.on]:[background:var(--eye-pupil)] [&.on]:[box-shadow:0_0_0_3px_color-mix(in_srgb,_var(--eye-pupil)_18%,_transparent)]
`

export const EyeTitleRowStyles = `
  flex w-full max-w-6xl mx-auto items-center gap-4 px-4 pt-5 pb-4 sm:px-8 sm:pt-8
`

export const EyeEyebrowStyles = `
  [font-size:10px] [letter-spacing:1.6px] [font-weight:600] [color:var(--muted-foreground)]
`

export const EyeFormatsStyles = `
  clay-well inline-flex flex-wrap gap-1 rounded-2xl p-1 [&_button]:flex [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-xl [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:font-semibold [&_button[aria-pressed=true]]:bg-pine [&_button[aria-pressed=true]]:text-white
`

export const EyeStepNavStyles = `
  mx-auto w-full max-w-6xl shrink-0 px-4 pb-5 sm:px-8
`

export const EyeBreadcrumbsStyles = `
  grid list-none grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2
`

export const EyeStepStyles = `
  flex h-full min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-surface px-2 py-2 text-sm font-semibold text-pine-soft [&.active]:bg-pine [&.active]:text-white [&.done]:text-teal
`

export const EyeStepNumberStyles = `
  grid size-5 shrink-0 place-items-center rounded-full bg-mist text-xs font-bold text-pine
`

export const EyeStepTextStyles = `
  min-w-0 text-center leading-tight
`

export const EyeWorkspaceStyles = `
  mx-auto grid w-full max-w-6xl shrink-0 grid-cols-1 gap-5 px-4 sm:px-8 md:min-h-[25rem] md:h-[clamp(25rem,52dvh,44rem)] md:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.3fr)]
`

export const EyePreviewColumnStyles = `
  min-w-0 h-[clamp(20rem,43dvh,32rem)] md:h-full min-h-0 flex items-center justify-center
`

export const EyePreviewCardStyles = `
  clay rounded-[1.75rem] min-w-0 min-h-0 flex flex-col overflow-hidden w-full h-full bg-pine [&.is-empty]:[--eye-preview:var(--surface)] [&.is-empty]:[--eye-preview-text:var(--pine)] [&.is-empty]:[--eye-preview-muted:var(--pine-soft)] [&.is-empty]:[--eye-preview-line:var(--border)]
`

export const EyeControlsStyles = `
  clay flex min-w-0 flex-col rounded-[1.75rem] md:min-h-0 md:overflow-y-auto
`

export const EyeControlsHeadingStyles = `
  px-6 pt-6 sm:px-7 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:leading-tight
`

export const EyeControlsBodyStyles = `
  px-6 pb-6 pt-2 sm:px-7
`

export const EyeBottomBarStyles = `mt-5 [&>div]:flex [&>div]:flex-wrap [&>div]:items-center [&>div]:justify-between [&>div]:gap-2 [&_.primary]:ml-auto [&_.eye-button]:min-w-28`
