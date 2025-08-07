# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js WhatsApp bot for BSL (a medical services company) that handles customer interactions, processes images (payment receipts, medical orders), and manages appointments. The bot integrates with WhatsApp via Whapi.cloud API, uses OpenAI for image classification and conversational AI, and connects to Wix for data storage.

## Common Development Commands

- **Start the application**: `npm start` or `node app.js`
- **Install dependencies**: `npm install`
- **Test**: No tests configured (displays "Error: no test specified")

## Code Architecture

### Main Components

- **app.js**: Express server with main webhook endpoint `/soporte` that handles WhatsApp messages
- **handlers/**: Core message processing logic
  - `controlBot.js`: Bot control logic (stop/start commands, admin controls)
  - `procesarImagen.js`: Image processing using OpenAI vision API for document classification
  - `procesarTexto.js`: Text message processing with conversation flow management
- **utils/**: Utility functions
  - `wixAPI.js`: Interface with Wix backend for data storage
  - `sendMessage.js`: WhatsApp message sending
  - `pdf.js`: PDF generation for medical certificates  
  - `consultarPaciente.js`: Patient information lookup
  - `marcarPagado.js`: Payment status updates
  - `validaciones.js`: Input validation utilities
  - `prompt.js`: AI prompts for OpenAI interactions

### Key Features

1. **Multi-actor system**: Distinguishes between users, admin (manual), and system (bot) messages
2. **Image classification**: Uses OpenAI GPT-4 Vision to classify uploaded images (payment receipts, medical orders, ID documents)
3. **Conversation context**: Maintains conversation history and context to provide relevant responses
4. **Payment processing**: Handles payment verification and medical certificate generation
5. **Bot control**: Admin can stop/start bot with specific phrases or keywords

### Environment Variables Required

- `OPENAI_KEY`: OpenAI API key for image processing and conversational AI
- `WHAPI_KEY`: Whapi.cloud API key for WhatsApp integration  
- `PORT`: Server port (defaults to 3000)

### Important Constants

- `BOT_NUMBER`: "573008021701" - The WhatsApp number used by the bot/admin
- Bot stops on phrases: "...transfiriendo con asesor", "...transfiriendo con asesor."
- Bot stops on keywords: "foundever", "ttec", "evertec", "rippling", "egreso"
- Bot reactivates with: "...te dejo con el bot 🤖"

### External Dependencies

- **OpenAI API**: Image classification and conversational responses
- **Whapi.cloud**: WhatsApp messaging API
- **Wix**: Backend data storage at bsl.com.co
- **api2pdf.com**: PDF generation service

### Data Flow

1. WhatsApp messages arrive at `/soporte` endpoint
2. Messages are classified by actor (user/admin/system)
3. User messages trigger different handlers based on content type
4. Images are processed through OpenAI vision API
5. Text messages go through conversation context analysis
6. Responses are sent back through WhatsApp API
7. All interactions are stored in Wix backend

### Development Notes

- Uses CommonJS modules (not ES6)
- Node.js version requirement: >=18
- No test framework currently configured
- Uses puppeteer for potential browser automation (medical certificate generation)