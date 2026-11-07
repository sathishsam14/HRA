# HRA – Horse Rating Automation (BTC Racing Department)

A front-end prototype for the Bangalore Turf Club (BTC) Racing Department to automate the post-race horse rating assessment process, handle expert overrides, generate Management Information System (MIS) reports, and track an audit trail.

## Tech Stack
- **Framework**: Next.js 15 (App Router, JavaScript `.js` / `.jsx`)
- **Styling**: Tailwind CSS, Inter font (`next/font/google`)
- **Icons**: `lucide-react`
- **Hosting**: Fully static export (`output: "export"`) configured for Netlify

## Getting Started Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

3. **Credentials**:
   - Username: `admin` / Password: `demo1234` (Role: Admin — View all, no override)
   - Username: `manager` / Password: `demo1234` (Role: Manager — View all, no override)
   - Username: `handicapper` / Password: `demo1234` (Role: Handicapper — Full access with Override & Review confirmation)

## Deploying to Netlify

This project is configured as a fully static site:
- Build command: `npm run build`
- Publish directory: `out`

Netlify deployment will automatically use settings from `netlify.toml`.
