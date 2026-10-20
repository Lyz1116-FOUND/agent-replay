import * as monaco from 'monaco-editor/editor/editor.api'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/languages/definitions/python/register'
import 'monaco-editor/languages/definitions/markdown/register'
import 'monaco-editor/languages/definitions/shell/register'
import 'monaco-editor/languages/definitions/typescript/register'
import 'monaco-editor/languages/definitions/javascript/register'
import 'monaco-editor/languages/definitions/yaml/register'

type MonacoEnvironment = {
  getWorker: (moduleId: string, label: string) => Worker
}

const environment: MonacoEnvironment = {
  getWorker() {
    return new EditorWorker()
  },
}

;(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = environment

loader.config({ monaco })

monaco.editor.defineTheme('agent-replay', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'c9d1d9' },
    { token: 'comment', foreground: '6b7684', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6a7' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'function', foreground: 'd2a8ff' },
  ],
  colors: {
    'editor.background': '#0d1015',
    'editor.foreground': '#c9d1d9',
    'editorLineNumber.foreground': '#3f4856',
    'editorLineNumber.activeForeground': '#8f98a6',
    'editor.lineHighlightBackground': '#141820',
    'editor.selectionBackground': '#264f78',
    'editorIndentGuide.background1': '#1c222c',
    'editorGutter.background': '#0d1015',
    'diffEditor.insertedTextBackground': '#3fb95026',
    'diffEditor.removedTextBackground': '#f8514926',
    'diffEditor.insertedLineBackground': '#3fb95014',
    'diffEditor.removedLineBackground': '#f8514914',
    'diffEditor.border': '#222833',
    'scrollbarSlider.background': '#2b324080',
    'scrollbarSlider.hoverBackground': '#3a4454aa',
  },
})

export { monaco }
