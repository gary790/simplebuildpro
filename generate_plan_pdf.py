from fpdf import FPDF
import datetime

class PlanPDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return  # Skip header on cover page
        self.set_font('Helvetica', 'B', 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, 'SimpleBuild Pro - Architecture Plan', new_x="RIGHT", new_y="TOP")
        self.cell(0, 8, 'CONFIDENTIAL', new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(59, 130, 246)
        self.set_line_width(0.5)
        self.line(10, 16, 200, 16)
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', new_x="LMARGIN", new_y="NEXT", align='C')

    def section_title(self, title):
        self.ln(4)
        self.set_font('Helvetica', 'B', 14)
        self.set_text_color(30, 30, 30)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(59, 130, 246)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 80, self.get_y())
        self.ln(3)

    def sub_title(self, title):
        self.ln(2)
        self.set_font('Helvetica', 'B', 11)
        self.set_text_color(50, 50, 50)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body_text(self, text):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(60, 60, 60)
        # Replace unicode chars
        text = text.replace('\u2014', '--').replace('\u2013', '-').replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def bullet(self, text, indent=10):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(60, 60, 60)
        text = text.replace('\u2014', '--').replace('\u2013', '-').replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')
        x_start = self.l_margin + indent
        self.set_x(x_start)
        self.cell(4, 5.5, '-')
        text_x = x_start + 4
        text_w = self.w - self.r_margin - text_x
        self.multi_cell(text_w, 5.5, text)

    def code_block(self, code):
        self.ln(1)
        self.set_fill_color(245, 245, 250)
        self.set_font('Courier', '', 8)
        self.set_text_color(40, 40, 40)
        code = code.replace('\u2014', '--').replace('\u2013', '-').replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')
        lines = code.strip().split('\n')
        block_width = 190
        for line in lines:
            if self.get_y() > 265:
                self.add_page()
            safe = line.encode('latin-1', 'replace').decode('latin-1')
            self.cell(block_width, 4.5, '  ' + safe, new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)

    def table_row(self, cols, widths, bold=False, header=False):
        self.set_font('Helvetica', 'B' if bold or header else '', 9)
        if header:
            self.set_fill_color(59, 130, 246)
            self.set_text_color(255, 255, 255)
        else:
            self.set_fill_color(250, 250, 255)
            self.set_text_color(60, 60, 60)
        row_height = 7
        for i, (col, w) in enumerate(zip(cols, widths)):
            safe = str(col).encode('latin-1', 'replace').decode('latin-1')
            is_last = (i == len(cols) - 1)
            if is_last:
                self.cell(w, row_height, ' ' + safe, 1, new_x="LMARGIN", new_y="NEXT", fill=header)
            else:
                self.cell(w, row_height, ' ' + safe, 1, new_x="RIGHT", new_y="TOP", fill=header)

    def check_page_break(self, needed=30):
        if self.get_y() > 270 - needed:
            self.add_page()


pdf = PlanPDF()
pdf.alias_nb_pages()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()

# Cover
pdf.ln(25)
pdf.set_font('Helvetica', 'B', 28)
pdf.set_text_color(30, 30, 30)
pdf.cell(0, 15, 'SimpleBuild Pro', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.set_font('Helvetica', '', 16)
pdf.set_text_color(59, 130, 246)
pdf.cell(0, 10, 'Phase 2: Real Sandbox Architecture', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.ln(5)
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 7, 'AI-Powered Website Builder with Live Code Execution', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.cell(0, 7, f'Architecture Plan - {datetime.date.today().strftime("%B %d, %Y")}', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.ln(10)
pdf.set_draw_color(200, 200, 200)
pdf.line(60, pdf.get_y(), 150, pdf.get_y())
pdf.ln(10)
pdf.set_font('Helvetica', '', 10)
pdf.set_text_color(80, 80, 80)
pdf.cell(0, 6, 'Platform: Google Cloud (Cloud Run + Cloud SQL)', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.cell(0, 6, 'Sandbox Provider: E2B.dev', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.cell(0, 6, 'AI Model: Anthropic Claude (claude-opus-4-20250514)', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.cell(0, 6, 'Framework: Hono (API) + Next.js (Frontend)', new_x="LMARGIN", new_y="NEXT", align='C')

# Page 2: Executive Summary
pdf.add_page()
pdf.section_title('1. Executive Summary')
pdf.body_text(
    'SimpleBuild Pro is transitioning from a database-backed file storage model to a real Linux sandbox '
    'architecture. This change enables the AI assistant to execute real commands (grep, sed, npm, etc.) '
    'against actual project files in a containerized environment, matching the capabilities of industry '
    'leaders like Bolt.new, Lovable, and Cursor.'
)
pdf.sub_title('Problems with Current Architecture')
pdf.bullet('Files stored in PostgreSQL -- AI dumps entire files every time, causing duplicates')
pdf.bullet('No edit/delete capability -- AI can only create, never modify or remove existing code')
pdf.bullet('Files blank on reload -- API endpoint missing content field in response')
pdf.bullet('No live preview server -- iframe uses srcdoc/blob URL instead of real dev server')
pdf.bullet('AI has no feedback loop -- cannot see errors, test code, or iterate')
pdf.ln(2)
pdf.sub_title('What the Sandbox Architecture Solves')
pdf.bullet('AI runs real bash commands: grep to find, sed to edit, rm to delete, npm to install')
pdf.bullet('Files persist in real filesystem -- no blank files, no DB sync issues')
pdf.bullet('Live preview from actual dev server running inside the sandbox')
pdf.bullet('AI can test its own code, see errors, and fix them autonomously')
pdf.bullet('Users can install packages, run scripts, use any framework')

# Page 3: Architecture Overview
pdf.add_page()
pdf.section_title('2. Architecture Overview')
pdf.sub_title('System Diagram')
pdf.body_text(
    'The system consists of four layers: Browser (Next.js frontend), API Server (Hono on Cloud Run), '
    'E2B Sandbox Service (per-project Linux containers), and Cloud SQL (metadata, auth, billing).'
)
pdf.code_block("""
BROWSER (Next.js)
  |-- AI Chat Panel (left) -----> API: POST /api/v1/ai/chat/stream
  |-- Preview Panel (right) ----> iframe src="https://xyz-3000.e2b.dev"
  |-- Code Editor (tab) --------> API: GET /api/v1/sandbox/:id/files/:path
  |-- File Explorer (tab) ------> API: GET /api/v1/sandbox/:id/files

API SERVER (Hono on Cloud Run)
  |-- Auth + Session middleware
  |-- AI Stream endpoint -------> Claude API (tool_use with sandbox tools)
  |-- Sandbox routes ------------> E2B SDK (create, exec, files, kill)
  |-- Project metadata ----------> Cloud SQL (PostgreSQL)

E2B SANDBOX (per project)
  |-- Linux container (Debian)
  |-- Node.js 20 + npm
  |-- Project files in /home/user/project/
  |-- Dev server on port 3000
  |-- Public URL: https://xyz-3000.e2b.dev
""")
pdf.sub_title('What Stays (No Changes)')
pdf.bullet('Cloud Run API server (Hono framework)')
pdf.bullet('Next.js frontend + editor layout (AI chat left, tabbed right)')
pdf.bullet('Authentication system (JWT, OAuth, sessions)')
pdf.bullet('Billing and usage tracking')
pdf.bullet('GitHub push, Cloudflare deploy, Vercel deploy tools')
pdf.bullet('Cloud SQL for users, projects metadata, conversations, billing')
pdf.ln(2)
pdf.sub_title('What Changes')
pdf.bullet('Files: PostgreSQL projectFiles table -> sandbox filesystem (source of truth)')
pdf.bullet('Preview: srcdoc/blob iframe -> iframe pointing to sandbox URL')
pdf.bullet('AI tools: XML protocol -> Anthropic tool_use with bash/file operations')
pdf.bullet('Project open: load files from DB -> start/resume sandbox')
pdf.bullet('Project close: nothing -> snapshot sandbox to GCS for persistence')
pdf.ln(2)
pdf.sub_title('What Gets Removed')
pdf.bullet('XML protocol parsing (<plan>, <file>, <explanation> tags)')
pdf.bullet('persistFilesToDB() function during AI streaming')
pdf.bullet('Frontend file-chunk streaming logic')
pdf.bullet('projectFiles table as source of truth (becomes backup/snapshot only)')

# Page 4: E2B Integration
pdf.add_page()
pdf.section_title('3. E2B Sandbox Integration')
pdf.sub_title('3.1 What is E2B?')
pdf.body_text(
    'E2B (e2b.dev) is a sandbox-as-a-service platform that provides on-demand Linux containers '
    'accessible via API. Each sandbox is an isolated environment with a full filesystem, network access, '
    'and the ability to run any process. Sandboxes are created in ~500ms and can be paused/resumed.'
)
pdf.sub_title('3.2 Pricing')
w = [60, 65, 65]
pdf.table_row(['Resource', 'Cost', 'Notes'], w, header=True)
pdf.table_row(['Active sandbox', '$0.10/hour', 'Per running container'], w)
pdf.table_row(['Paused sandbox', 'Free', 'Filesystem preserved'], w)
pdf.table_row(['CPU (default)', '2 vCPU', 'Included in base price'], w)
pdf.table_row(['RAM (default)', '512 MB', 'Upgradable to 8 GB'], w)
pdf.table_row(['Disk', '5 GB', 'Persistent while active'], w)
pdf.table_row(['Network', 'Included', 'Public URLs for any port'], w)
pdf.ln(3)
pdf.sub_title('3.3 Cost Estimate per User Session')
pdf.body_text(
    'Average user session: 20-30 minutes of active building.\n'
    'Cost per session: ~$0.03-$0.05\n'
    'With 1,000 active users doing 3 sessions/day: ~$90-$150/day\n'
    'This is comparable to the Claude API cost per session (~$0.10-0.50 for opus).'
)
pdf.sub_title('3.4 E2B SDK Usage')
pdf.code_block("""
import { Sandbox } from '@e2b/code-interpreter';

// Create sandbox for a new project
const sandbox = await Sandbox.create({
  template: 'simplebuildpro-base',  // Custom template
  timeout: 60 * 60 * 1000,         // 1 hour
  metadata: { projectId, userId },
});

// Execute commands
const result = await sandbox.commands.run('grep -rn "hello" .');
console.log(result.stdout, result.stderr, result.exitCode);

// File operations
await sandbox.files.write('/home/user/project/index.html', content);
const content = await sandbox.files.read('/home/user/project/index.html');
const files = await sandbox.files.list('/home/user/project/');

// Get public URL for preview
const previewUrl = sandbox.getHost(3000);

// Pause sandbox (preserves files, stops billing)
await sandbox.pause();

// Resume later
const sandbox2 = await Sandbox.resume(sandboxId);
""")

# Page 5: AI Tool Definitions
pdf.add_page()
pdf.section_title('4. AI Agent Tool Definitions')
pdf.body_text(
    'The AI agent uses Anthropic Claude tool_use (function calling) to interact with the sandbox. '
    'These tools replace the old XML protocol entirely. Claude decides which tools to call based on '
    "the user's request, sees the results, and iterates until the task is complete."
)
pdf.sub_title('4.1 Tool: run_command')
pdf.body_text('Execute any bash command in the sandbox. Primary tool for searching, editing, and managing files.')
pdf.code_block("""
{
  name: "run_command",
  description: "Run a bash command in the project sandbox. Use for:
    - grep/find to search files
    - sed to edit files in place
    - cat to read file contents
    - rm to delete files
    - mkdir to create directories
    - npm install to add packages
    - Any other shell command",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The bash command" }
    },
    required: ["command"]
  }
}
""")
pdf.sub_title('4.2 Tool: write_file')
pdf.body_text('Write or overwrite a complete file. For new files or full rewrites.')
pdf.code_block("""
{
  name: "write_file",
  description: "Create or overwrite a file in the project sandbox.
    For small edits, prefer run_command with sed instead.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to root" },
      content: { type: "string", description: "Complete file content" }
    },
    required: ["path", "content"]
  }
}
""")
pdf.sub_title('4.3 Tool: read_file')
pdf.body_text('Read a file. Used when AI needs to check current state before editing.')
pdf.code_block("""
{
  name: "read_file",
  description: "Read a file from the project sandbox.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" }
    },
    required: ["path"]
  }
}
""")
pdf.check_page_break(60)
pdf.sub_title('4.4 Tool: list_files')
pdf.body_text('List all files in the project. Gives AI awareness of project structure.')
pdf.code_block("""
{
  name: "list_files",
  description: "List files and directories in the project sandbox.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: root)" }
    },
    required: []
  }
}
""")

# Page 6: AI Stream Endpoint
pdf.add_page()
pdf.section_title('5. AI Stream Endpoint - Rewritten')
pdf.body_text(
    "The /api/v1/ai/chat/stream endpoint is rewritten to use the tool-calling loop pattern. "
    "Instead of parsing XML from Claude's text output, we use Anthropic's native tool_use feature. "
    "Claude decides what to do, calls tools, sees results, and repeats until done."
)
pdf.sub_title('5.1 The Tool Loop')
pdf.code_block("""
POST /api/v1/ai/chat/stream

1. Receive user message
2. Get project sandbox (or create one)
3. List files in sandbox -> build context for system prompt
4. Send to Claude with tools: [run_command, write_file, read_file,
   list_files, github_push, cloudflare_deploy, ...]
5. LOOP:
   a. Stream Claude response to frontend
   b. If Claude calls a tool:
      - Execute tool against sandbox
      - Send tool result back to Claude
      - Send action event to frontend
      - Continue loop
   c. If Claude stops (no more tool calls):
      - Send stream_end to frontend
      - Break loop
6. Save conversation to DB
""")
pdf.sub_title('5.2 SSE Events (Frontend Protocol)')
pdf.body_text('The SSE events sent to the frontend are simplified:')
w2 = [35, 85, 70]
pdf.table_row(['Event Type', 'Data', 'Purpose'], w2, header=True)
pdf.table_row(['stream_start', 'conversationId, sandboxUrl', 'Init + preview URL'], w2)
pdf.table_row(['text', 'token (string)', 'AI talking to user'], w2)
pdf.table_row(['tool_call', 'tool, input', 'AI about to run a tool'], w2)
pdf.table_row(['tool_result', 'tool, output, exitCode', 'Tool execution result'], w2)
pdf.table_row(['file_changed', 'path, action (create/edit/del)', 'File was modified'], w2)
pdf.table_row(['stream_end', 'conversationId, tokensUsed', 'Stream complete'], w2)
pdf.table_row(['error', 'message', 'Error occurred'], w2)
pdf.ln(3)
pdf.sub_title('5.3 System Prompt (Redesigned)')
pdf.body_text(
    'The system prompt no longer instructs the AI to output XML tags. Instead, it tells the AI '
    'it has tools to interact with a real project filesystem.'
)
pdf.code_block("""
You are the AI assistant for SimpleBuild Pro Studio.
You have access to the user's project as a real filesystem.

Tools available:
- run_command: Run any bash command (grep, sed, cat, rm, npm...)
- write_file: Create or overwrite a file
- read_file: Read a file
- list_files: List directory contents
- github_push: Push to GitHub
- cloudflare_deploy: Deploy to Cloudflare Pages

WORKFLOW:
1. FIRST use grep/read_file to understand what exists
2. Use sed for surgical edits, write_file for new files
3. After changes, verify with cat/read_file if needed
4. Explain what you did in plain text

RULES:
- ALWAYS read before editing (don't assume contents)
- Prefer sed for small edits over full rewrites
- Use rm to delete files when asked
- For web projects, index.html is the entry point
- A dev server runs on port 3000 automatically
""")

# Page 7: Sandbox Lifecycle
pdf.add_page()
pdf.section_title('6. Sandbox Lifecycle Management')
pdf.sub_title('6.1 Lifecycle States')
pdf.code_block("""
  [No Sandbox]
       |
       | User opens project
       v
  [Creating] ---> E2B API: Sandbox.create()
       |          - Load template (Node.js + dev server)
       |          - Restore files from last snapshot
       |          - Start dev server on port 3000
       v
  [Running] <---> AI executes tools, user edits code
       |          - Preview available at sandbox URL
       |          - Auto-snapshot every 5 minutes
       |
       | User closes / idle timeout (30 min)
       v
  [Pausing] ----> E2B API: sandbox.pause()
       |          - Snapshot files to GCS
       |          - Save sandbox ID to project metadata
       v
  [Paused] -----> Free (no billing)
       |
       | User re-opens project
       v
  [Resuming] ---> E2B API: Sandbox.resume(id)
       |          - Sandbox restored with all files
       |          - Dev server restarts
       v
  [Running] (back to active state)
""")
pdf.sub_title('6.2 Database Schema Changes')
pdf.body_text('Add sandbox tracking fields to the projects table:')
pdf.code_block("""
ALTER TABLE projects ADD COLUMN sandbox_id TEXT;
ALTER TABLE projects ADD COLUMN sandbox_url TEXT;
ALTER TABLE projects ADD COLUMN sandbox_status TEXT DEFAULT 'none';
  -- Values: 'none', 'creating', 'running', 'paused', 'error'
ALTER TABLE projects ADD COLUMN sandbox_last_active TIMESTAMP;
ALTER TABLE projects ADD COLUMN sandbox_snapshot_url TEXT;
""")
pdf.sub_title('6.3 Snapshot Strategy')
pdf.body_text(
    'When a sandbox is paused or before shutdown, the project files are snapshotted:\n\n'
    '1. Run "tar -czf /tmp/snapshot.tar.gz /home/user/project/" inside sandbox\n'
    '2. Download the tar.gz via E2B file API\n'
    '3. Upload to GCS: gs://simplebuildpro-snapshots/{projectId}/{timestamp}.tar.gz\n'
    '4. Store snapshot URL in project metadata\n'
    '5. On resume, if files missing, restore from latest snapshot\n\n'
    'The projectFiles table in PostgreSQL becomes a backup/export mechanism.'
)

# Page 8: API Routes
pdf.add_page()
pdf.section_title('7. New API Routes')
pdf.sub_title('7.1 Sandbox Management Routes')
pdf.code_block("""
POST   /api/v1/sandbox/:projectId/start
  -> Creates or resumes sandbox
  -> Returns { sandboxId, url, status }

POST   /api/v1/sandbox/:projectId/stop
  -> Snapshots and pauses sandbox

GET    /api/v1/sandbox/:projectId/status
  -> Returns { sandboxId, url, status, lastActive }

POST   /api/v1/sandbox/:projectId/exec
  -> Runs a command: { command }
  -> Returns { stdout, stderr, exitCode }

GET    /api/v1/sandbox/:projectId/files
  -> Lists all files: [{ path, size, modified }]

GET    /api/v1/sandbox/:projectId/files/:path
  -> Reads file content: { path, content }

PUT    /api/v1/sandbox/:projectId/files/:path
  -> Writes file: { content } -> { path, size }

DELETE /api/v1/sandbox/:projectId/files/:path
  -> Deletes file
""")
pdf.sub_title('7.2 Modified AI Chat Route')
pdf.code_block("""
POST /api/v1/ai/chat/stream  (REWRITTEN)
  Body: { projectId, conversationId?, message }

  Changes:
  - Gets sandbox for project (starts if needed)
  - Reads file listing from sandbox (not DB)
  - Uses sandbox tools instead of XML protocol
  - Tool loop: Claude calls tools -> execute -> return
  - Streams SSE: text, tool_call, tool_result, file_changed
  - No more XML parsing, no persistFilesToDB
""")
pdf.sub_title('7.3 Routes That Stay Unchanged')
pdf.bullet('Auth routes (/api/v1/auth/*)')
pdf.bullet('Billing routes (/api/v1/billing/*)')
pdf.bullet('Build routes (/api/v1/build/*)')
pdf.bullet('Deploy routes (/api/v1/deploy/*)')
pdf.bullet('Asset routes (/api/v1/assets/*)')
pdf.bullet('OAuth routes (/api/v1/oauth/*)')

# Page 9: Frontend Changes
pdf.add_page()
pdf.section_title('8. Frontend Changes')
pdf.sub_title('8.1 Editor Page (page.tsx)')
pdf.body_text('The editor page changes how it initializes and manages the project:')
pdf.code_block("""
Current flow:
  1. projectsApi.get(projectId)  -> loads files from DB
  2. Set files in Zustand store
  3. Preview uses srcdoc/blob URL

New flow:
  1. projectsApi.get(projectId)  -> loads project metadata
  2. sandboxApi.start(projectId) -> starts/resumes sandbox
  3. Get sandbox URL for preview iframe
  4. File explorer reads from sandbox API
  5. Code editor reads/writes via sandbox API
  6. Preview iframe src = sandbox URL (port 3000)
""")
pdf.sub_title('8.2 Preview Panel')
pdf.body_text(
    'The preview panel becomes much simpler. Instead of constructing HTML blobs, '
    "it just points an iframe at the sandbox dev server URL."
)
pdf.code_block("""
// Before (complex blob URL construction)
const blob = new Blob([htmlContent], { type: 'text/html' });
const url = URL.createObjectURL(blob);
<iframe src={url} />

// After (simple URL)
<iframe src={sandboxUrl} />
// sandboxUrl = "https://abc123-3000.e2b.dev"
""")
pdf.sub_title('8.3 AI Chat Panel')
pdf.body_text('The AI chat panel handles new SSE event types:')
pdf.code_block("""
// New events to handle:
'text'          -> AI talking to user (append to message)
'tool_call'     -> Show "Running: grep -rn 'hello' ." badge
'tool_result'   -> Show result (exit code, truncated output)
'file_changed'  -> Refresh file explorer, reload preview
'stream_end'    -> Done

// Removed events (no longer needed):
'plan', 'file_start', 'file_chunk', 'file_end',
'plan_progress', 'explanation', 'text_token'
""")
pdf.sub_title('8.4 Code Editor')
pdf.body_text(
    'The code editor switches from Zustand store to sandbox API calls:\n\n'
    '- Open file: GET /api/v1/sandbox/:id/files/:path\n'
    '- Save file: PUT /api/v1/sandbox/:id/files/:path\n'
    '- File explorer: GET /api/v1/sandbox/:id/files\n\n'
    'Zustand store caches locally for performance, but sandbox is source of truth.'
)

# Page 10: Implementation Plan
pdf.add_page()
pdf.section_title('9. Implementation Plan')
pdf.sub_title('Step 1: E2B SDK Setup (API)')
pdf.bullet('Install @e2b/code-interpreter in apps/api')
pdf.bullet('Create E2B API key and add to GCP Secret Manager')
pdf.bullet('Create custom E2B template with Node.js + dev server')
pdf.bullet('Add sandbox service: apps/api/src/services/sandbox.ts')
pdf.bullet('Create sandbox routes: apps/api/src/routes/sandbox.ts')
pdf.ln(1)
pdf.sub_title('Step 2: Database Schema Update')
pdf.bullet('Add sandbox columns to projects table')
pdf.bullet('Create migration file')
pdf.bullet('Run migration on Cloud SQL')
pdf.ln(1)
pdf.sub_title('Step 3: AI Tools Implementation')
pdf.bullet('Define Anthropic tool schemas (run_command, write_file, read_file, list_files)')
pdf.bullet('Create tool executor that runs against E2B sandbox')
pdf.bullet('Keep existing tools (github_push, cloudflare_deploy, etc.)')
pdf.ln(1)
pdf.sub_title('Step 4: Rewrite AI Stream Endpoint')
pdf.bullet('Remove XML protocol parsing')
pdf.bullet('Implement tool-calling loop with streaming')
pdf.bullet('New SSE event types (text, tool_call, tool_result, file_changed)')
pdf.bullet('Sandbox auto-start when AI chat begins')
pdf.ln(1)
pdf.sub_title('Step 5: Frontend Updates')
pdf.bullet('Update editor page to start sandbox on load')
pdf.bullet('Preview panel: iframe src = sandbox URL')
pdf.bullet('Code editor: read/write via sandbox API')
pdf.bullet('File explorer: list from sandbox API')
pdf.bullet('AI chat: handle new event types, show tool execution badges')
pdf.ln(1)
pdf.sub_title('Step 6: Sandbox Lifecycle')
pdf.bullet('Auto-pause after 30 min idle')
pdf.bullet('Snapshot to GCS on pause')
pdf.bullet('Restore from snapshot on resume')
pdf.bullet('Cleanup old snapshots (keep last 5)')
pdf.ln(1)
pdf.sub_title('Step 7: Deploy and Test')
pdf.bullet('Build API and Web')
pdf.bullet('Deploy to Cloud Run')
pdf.bullet('Test: create project -> AI chat -> preview -> close -> reopen')

# Page 11: File Change Manifest
pdf.add_page()
pdf.section_title('10. File Change Manifest')
pdf.body_text('Complete list of files that will be created or modified:')
pdf.ln(2)
pdf.sub_title('New Files')
w3 = [95, 95]
pdf.table_row(['File', 'Purpose'], w3, header=True)
pdf.table_row(['apps/api/src/services/sandbox.ts', 'E2B sandbox service wrapper'], w3)
pdf.table_row(['apps/api/src/routes/sandbox.ts', 'Sandbox REST API routes'], w3)
pdf.table_row(['migrations/XXXX_add_sandbox.sql', 'DB schema migration'], w3)
pdf.table_row(['e2b-templates/simplebuildpro-base/', 'Custom E2B template config'], w3)
pdf.ln(3)
pdf.sub_title('Modified Files')
pdf.table_row(['File', 'Changes'], w3, header=True)
pdf.table_row(['apps/api/src/routes/ai.ts', 'Rewrite stream endpoint, new tools'], w3)
pdf.table_row(['apps/api/src/index.ts', 'Register sandbox routes'], w3)
pdf.table_row(['apps/api/package.json', 'Add @e2b/code-interpreter dep'], w3)
pdf.table_row(['apps/web/.../page.tsx', 'Sandbox init, preview URL'], w3)
pdf.table_row(['apps/web/.../ai-chat.tsx', 'New SSE event handlers'], w3)
pdf.table_row(['apps/web/.../preview-panel.tsx', 'iframe src = sandbox URL'], w3)
pdf.table_row(['apps/web/.../code-editor.tsx', 'Read/write via sandbox API'], w3)
pdf.table_row(['apps/web/.../file-tree.tsx', 'List from sandbox API'], w3)
pdf.table_row(['apps/web/app/lib/api-client.ts', 'Add sandboxApi, new stream events'], w3)
pdf.table_row(['apps/web/app/lib/store.ts', 'Add sandbox state to store'], w3)
pdf.table_row(['packages/db/src/schema.ts', 'Add sandbox fields to projects'], w3)
pdf.ln(3)
pdf.sub_title('Removed Code (within modified files)')
pdf.bullet('XML protocol parser: parseXMLResponse() in ai.ts')
pdf.bullet('File persistence during stream: persistFilesToDB() calls')
pdf.bullet('XML streaming state machine in /chat/stream handler')
pdf.bullet('Frontend: file_chunk, file_start, file_end, plan_progress events')
pdf.bullet('Frontend: srcdoc/blob URL construction in preview panel')

# Page 12: Risks + Metrics + Timeline
pdf.add_page()
pdf.section_title('11. Risks and Mitigations')
w4 = [55, 65, 70]
pdf.table_row(['Risk', 'Impact', 'Mitigation'], w4, header=True)
pdf.table_row(['E2B service outage', 'Users cannot build', 'Fallback to DB-based mode'], w4)
pdf.table_row(['Sandbox start latency', '~1-3s on project open', 'Pre-warm; loading UI'], w4)
pdf.table_row(['Cost overrun', 'Sandboxes left running', 'Aggressive timeout (30m)'], w4)
pdf.table_row(['Malicious code', 'Security risk', 'E2B sandboxes are isolated'], w4)
pdf.table_row(['Large projects', 'Slow file sync', 'Snapshot/restore via tar'], w4)
pdf.table_row(['E2B rate limits', 'API throttling', 'Queue + retry w/ backoff'], w4)

pdf.ln(5)
pdf.section_title('12. Success Metrics')
pdf.bullet('AI edits work on first attempt (>90% success rate)')
pdf.bullet('Files persist across sessions (0% blank-files reports)')
pdf.bullet('Preview loads in <2 seconds after sandbox is running')
pdf.bullet('AI can search, edit, delete, and create files naturally')
pdf.bullet('Average sandbox cost per session < $0.10')
pdf.bullet('User can close and reopen project with no data loss')

pdf.ln(5)
pdf.section_title('13. Timeline Estimate')
w5 = [80, 50, 60]
pdf.table_row(['Task', 'Effort', 'Dependencies'], w5, header=True)
pdf.table_row(['E2B SDK + sandbox service', '2-3 hours', 'E2B API key'], w5)
pdf.table_row(['Sandbox routes + DB migration', '1-2 hours', 'Step 1'], w5)
pdf.table_row(['AI tools + stream rewrite', '3-4 hours', 'Steps 1-2'], w5)
pdf.table_row(['Frontend updates', '2-3 hours', 'Step 3'], w5)
pdf.table_row(['Sandbox lifecycle', '1-2 hours', 'Steps 1-4'], w5)
pdf.table_row(['Testing + deployment', '1-2 hours', 'All steps'], w5)
pdf.table_row(['TOTAL', '10-16 hours', '2-3 sessions'], w5)

# Page 13: Next Steps
pdf.add_page()
pdf.section_title('14. Immediate Next Steps')
pdf.ln(2)
pdf.body_text('To begin implementation, the following actions are required:')
pdf.ln(2)

pdf.sub_title('Action 1: Get E2B API Key')
pdf.body_text(
    'Sign up at e2b.dev and create an API key. This key will be stored in '
    'GCP Secret Manager as E2B_API_KEY and used by the API server to create '
    'and manage sandboxes.'
)

pdf.sub_title('Action 2: Install E2B SDK')
pdf.body_text(
    'Run: cd apps/api && npm install @e2b/code-interpreter\n'
    'This adds the E2B SDK to the API service.'
)

pdf.sub_title('Action 3: Create Sandbox Service')
pdf.body_text(
    'Create apps/api/src/services/sandbox.ts with functions for:\n'
    '- createSandbox(projectId) - create new sandbox\n'
    '- getSandbox(sandboxId) - get existing sandbox\n'
    '- pauseSandbox(sandboxId) - pause and snapshot\n'
    '- resumeSandbox(sandboxId) - resume from pause\n'
    '- execCommand(sandboxId, command) - run bash command\n'
    '- readFile(sandboxId, path) - read file\n'
    '- writeFile(sandboxId, path, content) - write file\n'
    '- listFiles(sandboxId, path) - list directory'
)

pdf.sub_title('Action 4: Rewrite AI Stream Endpoint')
pdf.body_text(
    'Replace the XML-based streaming in /api/v1/ai/chat/stream with the '
    'tool-calling loop pattern. This is the biggest single change and the '
    'core of the new architecture.'
)

pdf.sub_title('Action 5: Update Frontend')
pdf.body_text(
    'Update the editor page, preview panel, code editor, file explorer, '
    'and AI chat to work with the sandbox API instead of the database.'
)

pdf.ln(5)
pdf.set_draw_color(200, 200, 200)
pdf.line(60, pdf.get_y(), 150, pdf.get_y())
pdf.ln(5)
pdf.set_font('Helvetica', 'I', 10)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 7, 'End of Architecture Plan', new_x="LMARGIN", new_y="NEXT", align='C')
pdf.cell(0, 7, 'SimpleBuild Pro - Phase 2: Real Sandbox Architecture', new_x="LMARGIN", new_y="NEXT", align='C')

# Save
output_path = '/home/user/webapp/SimpleBuildPro_Phase2_Architecture_Plan.pdf'
pdf.output(output_path)
print(f'PDF created: {output_path}')
