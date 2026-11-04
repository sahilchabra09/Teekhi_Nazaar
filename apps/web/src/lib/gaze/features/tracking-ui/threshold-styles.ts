/** Static Tailwind primitives for threshold presentation. */

export const EyeThresholdControlsStyles = `
  min-w-0 space-y-3 rounded-2xl bg-mist p-4 text-pine [container-type:inline-size]
`

export const EyeThresholdHeadingStyles = `
  flex items-center justify-between [gap:12px]
  [min-height:44px] [padding:8px_14px] [border-bottom:1px_solid_var(--line)]
`

export const EyeThresholdTuningStyles = `
  grid [align-content:center] [gap:20px] [padding:16px]
  [@container(max-width:_900px)]:[grid-template-columns:auto_minmax(0,_1fr)] [@container(max-width:_900px)]:items-center [@container(max-width:_900px)]:[gap:10px] [@container(max-width:_900px)]:[padding:10px]
`

export const EyeThresholdTitleStyles = `
  flex [align-items:baseline] [gap:9px] [&_strong]:[font-size:12px]
  [&_strong]:[font-weight:600] [&_>_span]:[color:var(--dim)] [&_>_span]:[font-size:10px]
`

export const EyeThresholdModesStyles = `
  flex rounded-xl bg-surface p-1 [&_button]:min-h-9 [&_button]:flex-1 [&_button]:rounded-lg [&_button]:px-2 [&_button]:text-sm [&_button[aria-pressed=true]]:bg-teal [&_button[aria-pressed=true]]:text-white
`

export const EyeThresholdControlRowStyles = `
  grid [grid-template-columns:minmax(0,_1fr)_64px] [grid-template-areas:"label_value"_"slider_slider"] items-center
  [column-gap:12px] [row-gap:8px] [margin:0] [&:only-child]:[grid-column:1_/_-1]
  max-[480px]:[grid-template-columns:minmax(0,_1fr)_58px] max-[480px]:[column-gap:8px] max-[480px]:[row-gap:6px] [@container(max-width:_900px)]:[grid-template-columns:minmax(0,_1fr)_58px]
  [@container(max-width:_900px)]:[grid-template-areas:"slider_value"] [@container(max-width:_900px)]:[column-gap:8px] [@container(max-width:_900px)]:[row-gap:0]
`

export const EyeThresholdFieldLabelStyles = `
  [grid-area:label] [color:var(--dim)] [font-size:11px] [white-space:nowrap]
  [@container(max-width:_900px)]:hidden
`

export const EyeThresholdSliderStyles = `
  [grid-area:slider] [appearance:none] w-full [height:18px]
  [margin:0] [padding:0] [background:transparent] cursor-pointer
  [&::-webkit-slider-runnable-track]:[height:6px] [&::-webkit-slider-runnable-track]:[border-radius:999px] [&::-webkit-slider-runnable-track]:[background:linear-gradient(_to_right,_var(--eye-pupil)_0%,_var(--eye-pupil)_var(--threshold-progress),_#353936_var(--threshold-progress),_#353936_100%_)] [&::-webkit-slider-thumb]:[appearance:none]
  [&::-webkit-slider-thumb]:[width:16px] [&::-webkit-slider-thumb]:[height:16px] [&::-webkit-slider-thumb]:[margin-top:-5px] [&::-webkit-slider-thumb]:[border:2px_solid_var(--eye-pupil)]
  [&::-webkit-slider-thumb]:[border-radius:50%] [&::-webkit-slider-thumb]:[background:#f2f5f3] [&::-webkit-slider-thumb]:[box-shadow:0_1px_4px_#0008] [&::-moz-range-track]:[height:6px]
  [&::-moz-range-track]:[border-radius:999px] [&::-moz-range-track]:[background:#353936] [&::-moz-range-progress]:[height:6px] [&::-moz-range-progress]:[border-radius:999px]
  [&::-moz-range-progress]:[background:var(--eye-pupil)] [&::-moz-range-thumb]:[width:12px] [&::-moz-range-thumb]:[height:12px] [&::-moz-range-thumb]:[border:2px_solid_var(--eye-pupil)]
  [&::-moz-range-thumb]:[border-radius:50%] [&::-moz-range-thumb]:[background:#f2f5f3] [&::-moz-range-thumb]:[box-shadow:0_1px_4px_#0008]
`

export const EyeThresholdValueStyles = `
  [grid-area:value] h-9 w-full rounded-lg border border-pine/15 bg-white px-1 text-center text-sm tabular-nums text-pine
`
