# ResumeMaker

### Description
> This JavaScript & React Vercel full-stack project is my rendition of an online resume builder that are often paid - with this one being free and permanently dark mode. It offers direct real-time editing of a document with a UI that includes preset options for resume sections that users can write their own information within it. The app also incorporates importing of Markdown .md files to continue editing if one wishes to pick up their resume another time. Moreover, it offers PDF, Markdown, and Microsoft Word formatting as export options. I use this app to create my personal resumes and plan on using it in the future for the same purpose.

### Key Features
* Export in .md / Word Document / PDF
* Real-time document editing with a preview system
* Page Margin adjustment options
* Comprehensive spacing editing options
* Permanent dark mode UI
* Import Markdown files to continue making a previously made resume

### Tech Stack Used
- Programming Languages: JavaScript
- Frameworks: React.js, Node.js
- Tools and Libraries: Vercel, @sparticuz/chromium, jspdf, docx, marked, puppeteer, uuid, web-vitals

### Installation
* Make sure you have node.js, react.js installed
* git clone the repo
* Press start.bat to run ```npx vercel dev```
* Open [https://localhost:3000](https://localhost:3000) to start editing

### Usage Instructions
* Start off by editing the contact information at the top with your name, role, phone number, location, etc.
* Then, edit the preset sections already present or alternatively delete them with the delete button (on the UI)
* Add new sections on the left menu - with Standard (one headline and bullets) and Standard (two headlines and bullets) being the recommended ones.
* After editing, either export directly as PDF or Markdown(.md). With .md you can import it back into the app to resume, whereas PDF cannot.
