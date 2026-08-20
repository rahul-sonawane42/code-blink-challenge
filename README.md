# Code Chameleon

Act as an expert Full Stack Developer.
I am building a web-based "Blind Coding" competition platform for a local network event. I need the complete architectural setup, component structure, and code implementation. Keep the architecture as simple and lightweight as possible.
Tech Stack: React (initialized via Vite), Tailwind CSS, Node.js with Express (for a lightweight backend), and Socket.io.
Core Mechanics:

Team Structure: Each team has 4 members sharing a single machine. They have a total of 4 "lives" (attempts). Each member takes one turn.

The "Blind" Element: When a player types in the text area, the text must NOT be visible. The font color should be transparent.

UI Animation: While typing is active, an SPPU ACM logo or a cute animation should play in the center of the typing area to obscure the input field.

Layout Shift: When the timer starts, the problem statement should dynamically shrink and slide to the right side of the screen to make room for the typing area.

The Reveal: Once the timer expires, the typing area locks, the animation disappears, and the typed code is fully revealed on screen as plain text so it can be copied to a local compiler.

State Resilience (Critical): If a user accidentally reloads the page, no data can be lost. You must implement localStorage syncing that instantly recovers:

The Room Code

The currently typed (but hidden) code

The exact remaining time on the timer

The number of lives remaining (out of 4)

Host PC Dashboard: There must be a separate Host Interface connected via WebSockets. The host can:

Create a room and generate a room code.

View all connected teams.

Trigger the start timer for all teams simultaneously via WebSockets.

See real-time statuses (e.g., "Team A is typing...", "Team B finished").

Please generate:

The Vite + Express folder structure.

The React state management logic for the timer and browser storage.

The Node.js/Socket.io backend code for the Host <-> Client communication.

The React components for the Participant View (handling the layout shift and hidden text).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7daadb22-2ef6-444e-a2d4-e7f865ec0350).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
