# English Vocabulary Learning App

A React application to help users learn, track, and memorize English vocabulary effectively.

## Features

### 1. Word Lookup
- English pronunciation (audio)
- IPA phonetics (American English)
- Simple English definitions
- Example sentences (2 per word)
- Integration with Free Dictionary API

### 2. Word History & Tracking
- Daily word tracking
- Local storage of lookup history
- Spaced repetition testing based on memory curve
- Progress tracking

### 3. Review & Export
- Weekly word list review
- Export functionality for word lists
- CSV/PDF export options

## Technical Stack

### Frontend
- React
- Tailwind CSS for styling
- react-router-dom (HashRouter) for routing
- react-audio-player for pronunciation
- framer-motion for animations
- react-icons for icons
- recharts for statistics visualization

### State Management & Storage
- jotai for global state management
- localStorage/indexedDB for persistence
- Memory curve algorithm for spaced repetition

### Utils
- file-saver for export functionality

## Architecture

The application is divided into four main modules:
1. Word Lookup Module
2. History Tracking Module
3. Testing Module
4. Export Module

## Development Considerations

### Performance
- Optimized local storage operations
- Efficient state management
- Careful API call handling

### Error Handling
- API failure fallbacks
- Progress save/restore mechanisms
- User-friendly error messages

### Testing
- Multiple test scenarios
- Progress persistence
- Error case handling

## Dependencies

All required dependencies will be properly declared in package.json, including:
- react-icons
- recharts
- jotai
- file-saver
- react-datepicker (including CSS) 