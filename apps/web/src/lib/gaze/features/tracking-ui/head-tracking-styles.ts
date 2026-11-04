/** Static Tailwind primitives for head tracking presentation. */

export const EyeHeaderStyles = `
  [flex:0_0_56px] [height:56px] [padding:0_4%] [border-bottom:1px_solid_var(--line)]
  flex items-center justify-between [background:var(--card)]
  max-[650px]:[flex-basis:48px] max-[650px]:[height:48px] max-[650px]:[padding:0_14px] [@media(max-height:_760px)]:[flex-basis:48px]
  [@media(max-height:_760px)]:[height:48px]
`

export const EyeHeaderRightStyles = `
  flex items-center [gap:25px] [color:var(--dim)]
  max-[650px]:[gap:15px] max-[640px]:[&:has(.remote-trial-link)_.eye-local]:hidden
`

export const EyeHeadSetupStyles = `
  grid [gap:12px] [&_p]:[margin:0] [&_.eye-head-preview]:[margin-bottom:0]
  [&_.eye-button]:w-auto
`

export const EyeHeadPreviewStyles = `
  [margin:0] grid [gap:7px] [padding-top:12px]
  [border-top:1px_solid_var(--border)] [&_figcaption]:flex [&_figcaption]:items-center [&_figcaption]:[gap:6px]
  [&_figcaption]:[font-size:11px] [&_figcaption]:[color:var(--muted-foreground)] [&.is-inline]:[grid-template-columns:minmax(85px,_0.8fr)_minmax(0,_1fr)] [&.is-inline]:items-center
  [&.is-inline]:[margin-bottom:14px] [&.is-inline_.eye-head-preview-image]:[grid-column:1] [&.is-inline_.eye-head-preview-image]:[grid-row:1_/_span_3] [&.is-inline_figcaption]:[grid-column:2]
  [&.is-inline_.eye-head-vector-values]:[grid-column:2] [&.is-inline_.eye-help-tip]:[grid-column:2] [&.is-inline_.eye-head-vector-values]:grid [&.is-inline_.eye-head-vector-values]:[gap:2px]
`

export const EyeHeadPreviewImageStyles = `
  relative w-full [aspect-ratio:4_/_3] [background:#090909]
  [border-radius:6px] overflow-hidden [&_video]:absolute [&_video]:[inset:0]
  [&_video]:w-full [&_video]:h-full [&_svg]:absolute [&_svg]:[inset:0]
  [&_svg]:w-full [&_svg]:h-full [&_video]:[object-fit:fill] [&_video]:[transform:scaleX(-1)]
  [&_svg]:pointer-events-none [&_circle]:[fill:var(--primary)]
`

export const EyeHeadForwardVectorStyles = `
  [stroke:var(--primary)] [stroke-width:2]
`

export const EyeHeadUpVectorStyles = `
  [stroke:#fff] [stroke-width:1] [opacity:0.7]
`

export const EyeHeadVectorTipStyles = `
  [stroke:#090909] [stroke-width:1]
`

export const EyeHeadVectorValuesStyles = `
  flex justify-between [gap:6px] [font-size:10px]
  [color:var(--muted-foreground)] [&_output]:tabular-nums
`

export const EyeHeadFloatingStyles = `
  absolute [bottom:16px] [left:16px] [width:clamp(120px,_13vw,_180px)]
  pointer-events-none [&.on-right]:[left:auto] [&.on-right]:[right:16px] [&_.eye-head-preview]:[border:0]
  [&_.eye-head-preview]:[padding:0]
`

export const EyeCameraOrientationStyles = `
  [margin-top:16px]
`

export const EyeHeadOrientationStyles = `
  [gap:6px] [&_.eye-button[aria-pressed="true"]]:[color:var(--primary)] [&_.eye-button[aria-pressed="true"]]:[border-color:var(--primary)]
`
