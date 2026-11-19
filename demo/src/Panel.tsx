import { DEFAULT_SETTINGS, KEY_COLORS, RANGES } from '@snovakow/greenscreen'
import type { NumericSetting, Settings } from '@snovakow/greenscreen'
import GUI from 'lil-gui'
import type { Controller } from 'lil-gui'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { Mode } from './Preview.tsx'

// The tools' buttons, and what they say while their tool is up
const EDIT_CROP = 'Edit crop'
const EDITING = 'Drag the corners…'
const PICK_KEY = 'Pick key'
const PICKING = 'Click the preview…'

type KeyType = keyof typeof KEY_COLORS | 'custom'

// What the panel's controls edit: the library's settings, with the key chosen from presets or as a colour of its own
interface Values {
  key: boolean
  flip: boolean
  crop: boolean
  tint: number
  opacity: number
  contrast: number
  brightness: number
  gamma: number
  keyType: KeyType
  keyColor: number
  similarity: number
  smoothness: number
  spill: number
  saturation: number
}

const defaults = (): Values => ({
  key: DEFAULT_SETTINGS.key,
  flip: DEFAULT_SETTINGS.flip,
  crop: DEFAULT_SETTINGS.crop,
  tint: DEFAULT_SETTINGS.tint,
  opacity: DEFAULT_SETTINGS.opacity,
  contrast: DEFAULT_SETTINGS.contrast,
  brightness: DEFAULT_SETTINGS.brightness,
  gamma: DEFAULT_SETTINGS.gamma,
  keyType: 'green',
  keyColor: DEFAULT_SETTINGS.keyColor,
  similarity: DEFAULT_SETTINGS.similarity,
  smoothness: DEFAULT_SETTINGS.smoothness,
  spill: DEFAULT_SETTINGS.spill,
  saturation: DEFAULT_SETTINGS.saturation,
})

function toSettings(values: Values): Partial<Settings> {
  const { keyType, keyColor, ...rest } = values
  return { ...rest, keyColor: keyType === 'custom' ? keyColor : KEY_COLORS[keyType] }
}

// The controls the panel changes from outside it
interface PanelControls {
  key: Controller
  crop: Controller
  editCrop: Controller
  keyType: Controller
  keyColor: Controller
  pickKey: Controller
}

export interface PanelHandle {
  // Makes hex the key and turns the key on, as choosing Custom and that colour in the panel would
  setKey: (hex: number) => void
  // Turns Crop on or off, as its checkbox would
  setCrop: (on: boolean) => void
}

interface PanelProps {
  ref?: Ref<PanelHandle>
  // Any control changed, with all the settings it shows
  onChange: (settings: Partial<Settings>) => void
  // Crop's checkbox changed, by itself or by setCrop
  onCrop: (crop: boolean) => void
  // Reset puts them all back
  onReset: () => void
  // The tool up on the preview, which Edit crop and Pick key put up and down with onEditCrop and onPickKey
  mode: Mode
  onEditCrop: () => void
  onPickKey: () => void
}

// The settings, in the order the panel has always had them, with Key first and Reset last, and each number in the
// range the library gives it. The values outlive the panel, so one made again by StrictMode or a hot update starts
// where the last left off. The cleanup destroys the panel, so StrictMode leaves one
export function Panel({ ref, onChange, onCrop, onReset, mode, onEditCrop, onPickKey }: PanelProps) {
  const [values] = useState(defaults)
  const controls = useRef<PanelControls | null>(null)

  useEffect(() => {
    const gui = new GUI()
    const number = (name: NumericSetting, label: string) => {
      const { min, max, step } = RANGES[name]
      return gui.add(values, name, min, max, step).name(label)
    }

    const key = gui.add(values, 'key').name('Key')
    gui.add(values, 'flip').name('Flip')
    const crop = gui.add(values, 'crop').name('Crop').onChange(onCrop)
    const editCrop = gui.add({ editCrop: onEditCrop }, 'editCrop').name(EDIT_CROP)
    gui.addColor(values, 'tint').name('Color')
    number('opacity', 'Opacity')
    number('contrast', 'Contrast')
    number('brightness', 'Brightness')
    number('gamma', 'Gamma')

    // The key's own colour shows only when the type is Custom
    const keyType = gui
      .add(values, 'keyType', { Green: 'green', Blue: 'blue', Magenta: 'magenta', Custom: 'custom' })
      .name('Key color type')
    const keyColor = gui.addColor(values, 'keyColor').name('Key color')
    keyColor.show(values.keyType === 'custom')
    keyType.onChange((type: KeyType) => keyColor.show(type === 'custom'))
    const pickKey = gui.add({ pickKey: onPickKey }, 'pickKey').name(PICK_KEY)

    number('similarity', 'Similarity')
    number('smoothness', 'Smoothness')
    number('spill', 'Spill')
    number('saturation', 'Saturation')

    const reset = () => {
      Object.assign(values, defaults())
      gui.controllersRecursive().forEach((controller: Controller) => controller.updateDisplay())
      keyColor.show(false)
      onReset()
    }
    gui.add({ reset }, 'reset').name('Reset')

    gui.onChange(() => onChange(toSettings(values)))

    // Where the panel ends, as it opens, closes and shows Key color, for the stylesheet to keep the grown preview
    // below it
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--panel-bottom', `${gui.domElement.getBoundingClientRect().bottom}px`)
    })
    observer.observe(gui.domElement)

    controls.current = { key, crop, editCrop, keyType, keyColor, pickKey }
    return () => {
      controls.current = null
      observer.disconnect()
      root.style.removeProperty('--panel-bottom')
      gui.destroy()
    }
  }, [values, onChange, onCrop, onReset, onEditCrop, onPickKey])

  // Each tool's button says what to do next while its tool is up
  useEffect(() => {
    controls.current?.editCrop.name(mode === 'crop' ? EDITING : EDIT_CROP)
    controls.current?.pickKey.name(mode === 'pick' ? PICKING : PICK_KEY)
  }, [mode])

  // Setting the controls' values runs their handlers, as a change made in the panel does: Key color shows, with the
  // colour picked, and the settings go to the keyer
  useImperativeHandle(
    ref,
    () => ({
      setKey(hex: number) {
        controls.current?.keyType.setValue('custom')
        controls.current?.keyColor.setValue(hex)
        controls.current?.key.setValue(true)
      },
      setCrop(on: boolean) {
        controls.current?.crop.setValue(on)
      },
    }),
    [],
  )

  return null
}
