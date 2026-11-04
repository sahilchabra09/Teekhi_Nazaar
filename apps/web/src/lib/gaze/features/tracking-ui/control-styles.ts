/** Static Tailwind primitives for control presentation. */

export const EyeIconButtonStyles = `
  [width:32px] [height:32px] grid place-items-center
  [border-radius:6px] [border:1px_solid_var(--line)] [flex-shrink:0] [background:var(--card)]
`

export const EyeHelpTipStyles = `
  relative [flex:0_0_auto] inline-flex [z-index:10]
  [&_>_button]:[width:28px] [&_>_button]:[height:28px] [&_>_button]:[border:0] [&_>_button]:[background:transparent]
  [&_>_button]:[color:var(--dim)] [&_>_button:hover]:[color:var(--foreground)] [&_>_button:hover]:[background:var(--muted)]
`

export const EyeFloatingTooltipStyles = `
  fixed z-[1000] w-max max-w-[min(18rem,90vw)] rounded-xl bg-pine px-3 py-2 font-sans text-xs leading-relaxed text-white shadow-lg pointer-events-none
`

export const EyeGuidanceRowStyles = `
  flex items-center [gap:8px] justify-between
  [margin:12px_0] [&_.eye-muted]:[margin:0] relative
`

export const EyeActionRowStyles = `
  flex items-center [gap:8px]
`

export const EyeSourceActionsStyles = `
  flex items-center [gap:8px] [margin-top:16px]
  [&_>_.primary]:[flex:1]
`

export const EyeActionIconStyles = `
  [flex:0_0_39px] [width:39px] [padding:8px] [&[aria-pressed="true"]]:[background:var(--muted)]
  [&[aria-pressed="true"]]:[border-color:var(--primary)] [&[aria-pressed="true"]]:[color:var(--primary)] [min-width:39px]
`

export const EyeStatusIndicatorStyles = `
  inline-flex [color:var(--primary)]
`

export const EyeMutedStyles = `
  text-sm font-normal leading-relaxed text-pine-soft
`

export const EyeFieldStyles = `
  my-4 flex flex-col gap-2 text-sm font-semibold text-pine [&_input:not([type=range])]:min-h-11 [&_select]:min-h-11 [&_input:not([type=range])]:w-full [&_select]:w-full [&_input]:rounded-xl [&_select]:rounded-xl [&_input]:border [&_select]:border [&_input]:border-pine/15 [&_select]:border-pine/15 [&_input]:bg-white [&_select]:bg-white [&_input]:px-3 [&_select]:px-3
`

export const EyeButtonStyles = `
  clay-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-pine/15 bg-white px-4 py-2.5 text-sm font-bold text-pine [&.primary]:bg-pine [&.primary]:text-white [&.secondary]:bg-surface
`

export const EyeSourceTypeStyles = `
  my-3 grid grid-cols-2 gap-2 [&_button[aria-pressed=true]]:bg-teal [&_button[aria-pressed=true]]:text-white
`

export const EyeMessageStyles = `
  my-3 rounded-xl bg-mist px-4 py-3 text-sm text-pine [&.error]:bg-tomato/10 [&.error]:text-red-900
`

export const EyeDetailsStyles = `
  [border-top:1px_solid_var(--line)] [margin-top:16px] [padding-top:12px] [&_summary]:[font-size:10px]
  [&_summary]:cursor-pointer [&_summary]:[list-style:none] [&_summary]:flex [&_summary]:items-center
  [&_summary]:justify-between [&_summary]:[color:var(--muted-foreground)] [&_code]:block [&_code]:[font-size:10px]
  [&_code]:[margin:15px_0] [&_code]:[word-break:break-all] [&_>_.eye-help-tip]:flex [&_>_.eye-help-tip]:justify-end
`

export const EyeNumberGridStyles = `
  grid [grid-template-columns:1fr_1fr] [gap:10px]
`

export const EyeSmallStyles = `
  my-3 text-sm leading-relaxed text-pine-soft
`

export const EyeProgressTrackStyles = `
  [height:4px] [border-radius:3px] [background:var(--muted)] [margin:20px_0]
  [&_i]:[height:4px] [&_i]:block [&_i]:[background:var(--primary)] [&_i]:[border-radius:3px]
  [&_i]:[transition:width_0.2s]
`

export const EyeTextButtonStyles = `
  flex items-center [gap:7px] [font-size:10px]
  [color:var(--muted-foreground)] [margin:15px_0] [text-decoration:underline] [text-underline-offset:3px]
`

export const EyeGazeMapStyles = `
  [aspect-ratio:1.4] relative [border:1px_solid_var(--border)] [border-radius:7px]
  [margin:12px_0] [background:var(--muted)] overflow-hidden [&_.map-center-x]:absolute
  [&_.map-center-x]:[top:50%] [&_.map-center-x]:w-full [&_.map-center-x]:[border-top:1px_dashed_var(--border)] [&_.map-center-y]:absolute
  [&_.map-center-y]:[left:50%] [&_.map-center-y]:h-full [&_.map-center-y]:[border-left:1px_dashed_var(--border)] [&_>_i]:absolute
  [&_>_i]:[background:var(--primary)] [&_>_i]:[width:9px] [&_>_i]:[height:9px] [&_>_i]:[border-radius:50%]
  [&_>_i]:[transform:translate(-50%,_-50%)] [&_>_i]:[box-shadow:0_0_0_5px_color-mix(in_srgb,_var(--primary)_10%,_transparent)] [&_>_span:last-child]:absolute [&_>_span:last-child]:[bottom:6px]
  [&_>_span:last-child]:[left:0] [&_>_span:last-child]:[right:0] [&_>_span:last-child]:text-center [&_>_span:last-child]:[font-size:9px]
  [&_>_span:last-child]:[color:var(--muted-foreground)]
`

export const EyeLiveCoordinatesStyles = `
  flex [gap:28px] [font-size:10px] [color:var(--muted-foreground)]
  items-center [margin-bottom:16px] [&_.eye-status-indicator]:[margin-left:auto] [&_b]:[margin-left:8px]
  [&_b]:[color:var(--foreground)] [&_b]:[font-size:14px] [&_b]:[font-weight:450] [&_b]:tabular-nums
`

export const EyeValidationStyles = `
  [border-top:1px_solid_var(--line)] [border-bottom:1px_solid_var(--line)] [padding:12px_0] [margin:16px_0]
  flex items-center justify-between [gap:8px]
  [&_>_span]:[font-size:10px] [&_>_span]:[color:var(--muted-foreground)] [&_strong]:[font-size:13px] [&_strong]:[font-weight:450]
  [&_small]:[font-size:9px] [&_small]:[color:var(--muted-foreground)]
`

export const EyeSrOnlyStyles = `
  absolute [width:1px] [height:1px] [padding:0]
  [margin:-1px] overflow-hidden [clip:rect(0,_0,_0,_0)] [white-space:nowrap]
  [border:0]
`

export const EyeStatusDotStyles = `
  [width:6px] [height:6px] [border-radius:50%] [background:var(--muted-foreground)]
  [&.live]:[background:var(--primary)]
`

export const GazeOffsetControlsStyles = `
  grid [gap:8px] min-w-0 [padding-block:12px]
  [border-block:1px_solid_var(--border)] [color:var(--pine)] [font-size:12px] [&_:disabled]:[opacity:0.4]
  [&_:disabled]:[cursor:default] [&_:focus-visible]:[outline:2px_solid_var(--teal)] [&_:focus-visible]:[outline-offset:2px]
`

export const GazeOffsetHeadingStyles = `
  flex items-center justify-between [min-height:28px]
  [&_small]:[color:var(--pine-soft)] [&_small]:[font-size:11px]
`

export const GazeOffsetResetStyles = `
  grid place-items-center [width:30px] [height:28px]
  [padding:0] [border:1px_solid_var(--border)] [border-radius:5px] [background:transparent]
  [color:inherit] cursor-pointer [&:hover:not(:disabled)]:[background:var(--teal)] [&:hover:not(:disabled)]:[color:#fff]
`

export const GazeOffsetAxisStyles = `
  grid [grid-template-columns:34px_minmax(48px,_1fr)_76px] [gap:10px] items-center
  [&_input[type="range"]]:w-full [&_input[type="range"]]:min-w-0 [&_input[type="range"]]:[height:28px] [&_input[type="range"]]:[margin:0]
  [&_input[type="range"]]:[accent-color:var(--teal)] [&_input[type="range"]]:[cursor:ew-resize] [&_.gaze-offset-number]:w-full [&_.gaze-offset-number]:min-w-0
  [&_.gaze-offset-number]:[height:32px] [&_.gaze-offset-number]:[padding:4px_6px] [&_.gaze-offset-number]:[border:1px_solid_var(--border)] [&_.gaze-offset-number]:[border-radius:5px]
  [&_.gaze-offset-number]:[background:var(--surface)] [&_.gaze-offset-number]:[color:var(--pine)] [&_.gaze-offset-number]:[font:inherit] [&_.gaze-offset-number]:tabular-nums
  [&_.gaze-offset-number]:text-right
`

export const GazeOffsetLabelStyles = `
  flex items-center [gap:5px]
`
