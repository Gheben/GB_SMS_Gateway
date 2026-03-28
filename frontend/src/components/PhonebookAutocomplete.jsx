import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { User } from 'lucide-react'

const MAX_SUGGESTIONS = 8

/**
 * A controlled input with phonebook contact autocomplete dropdown.
 * The dropdown is rendered via a React portal at document.body so it is never
 * clipped by parent overflow:hidden/auto containers (e.g. scrollable modals).
 *
 * Props:
 *   contacts   - array of {display_name, phone, email} from phonebook API
 *   mode       - 'email' | 'phone'  (which field to match/fill)
 *   value      - current input value (controlled)
 *   onChange   - called with new string as user types
 *   onAdd      - optional: if provided, called with the full contact object on selection
 *                instead of filling the input (chip/list mode). Input is cleared.
 *   placeholder, className - forwarded to the <input>
 *   onKeyDown  - forwarded for extra key handling (e.g. Enter to add chip in SendSMS)
 *   ...rest    - any other props forwarded to the <input>
 */
export default function PhonebookAutocomplete({
  contacts = [],
  mode = 'phone',
  value,
  onChange,
  onAdd,
  placeholder,
  className = '',
  onKeyDown: externalOnKeyDown,
  ...rest
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dropdownStyle, setDropdownStyle] = useState({})
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)

  const field = mode === 'email' ? 'email' : 'phone'

  const suggestions = useMemo(() => {
    if (!value || value.length < 1) return []
    const q = value.toLowerCase()
    return contacts
      .filter(c => {
        if (!c[field]) return false
        const name = (c.display_name || '').toLowerCase()
        const fieldVal = c[field].toLowerCase()
        return name.includes(q) || fieldVal.includes(q)
      })
      .slice(0, MAX_SUGGESTIONS)
  }, [value, contacts, field])

  // Recompute fixed position of the dropdown below the input
  const reposition = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [])

  // Open/close and reposition whenever suggestions change
  useEffect(() => {
    if (suggestions.length > 0) {
      reposition()
      setOpen(true)
    } else {
      setOpen(false)
    }
    setActiveIndex(-1)
  }, [suggestions, reposition])

  // Keep dropdown aligned while scrolling/resizing
  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition])

  // Close when clicking outside both the input and the portal dropdown
  useEffect(() => {
    function onMouseDown(e) {
      if (
        !inputRef.current?.contains(e.target) &&
        !dropdownRef.current?.contains(e.target)
      ) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function selectContact(contact) {
    if (onAdd) {
      onAdd(contact)
    } else {
      onChange(contact[field])
    }
    setOpen(false)
    setActiveIndex(-1)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && open && activeIndex >= 0) {
      e.preventDefault()
      selectContact(suggestions[activeIndex])
    } else if (e.key === 'Escape' && open) {
      setOpen(false)
      setActiveIndex(-1)
    } else {
      externalOnKeyDown?.(e)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        {...rest}
      />
      {open && createPortal(
        <ul
          ref={dropdownRef}
          style={dropdownStyle}
          className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto text-sm"
        >
          {suggestions.map((c, i) => (
            <li key={c.id ?? i}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); selectContact(c) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors ${
                  i === activeIndex ? 'bg-blue-50' : ''
                }`}
              >
                <User size={13} className="text-gray-400 flex-shrink-0" />
                <span className="font-medium text-gray-800 truncate">{c.display_name}</span>
                <span className="text-gray-400 text-xs truncate ml-auto flex-shrink-0">{c[field]}</span>
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  )
}
