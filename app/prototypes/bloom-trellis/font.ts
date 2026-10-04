// The canvas can't use CSS variables, so the page passes in the resolved next/font family.
let family = "Georgia, serif"
let weight = 400
export const setFont = (resolvedFamily: string, w: number) => {
  family = `${resolvedFamily}, Georgia, serif`
  weight = w
}
export const fontFor = (fs: number) => `${weight} ${fs}px ${family}`
