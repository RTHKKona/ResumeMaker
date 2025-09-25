import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, VerticalAlign, ExternalHyperlink } from 'docx';
import { marked } from 'marked';

// Helper Functions
const getSortableDate = (item) => {
  let dateStr = '';
  if ('dates' in item) dateStr = item.dates || '';
  else if ('headline1_right' in item) dateStr = item.headline1_right || '';
  if (!dateStr) return [0, 0];
  if (dateStr.toLowerCase().includes('present')) return [new Date().getFullYear() + 100, 12];
  const years = dateStr.match(/\b(19\d{2}|20\d{2})\b/g) || [];
  const monthsStr = dateStr.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\b/gi) || [];
  if (!years.length) return [0, 0];
  const monthMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const months = monthsStr.map(m => monthMap[m.toLowerCase().slice(0, 3)]).filter(m => m);
  const latestYear = Math.max(...years.map(Number));
  const latestMonth = months.length ? Math.max(...months) : 12;
  return [latestYear, latestMonth];
};

const getSpacingClasses = (spacingDict, isDesc = false) => {
  if (isDesc && spacingDict.ultra_tight) return 'ultra-tight';
  const before = spacingDict.before ? 'space-before' : 'compact-before';
  const after = spacingDict.after ? 'space-after' : 'compact-after';
  return `${before} ${after}`;
};

const cleanText = (text = "") => {
  return marked.parse(text).replace(/<p>|<\/p>/g, '').trim();
};

// --- START: ORIGINAL MARKDOWN PARSING LOGIC (RESTORED) ---

// Parses the headline parts of an entry and determines its type and data structure.
const createNewEntryFromParts = (parts, sectionTitle) => {
  let entry = { id: uuidv4(), desc: '' };
  let guessedType = 'standard_one_headline'; // Default guess

  const normalizedTitle = sectionTitle.toUpperCase();

  // Heuristic-based parsing to guess the entry type
  if (parts.length >= 3 && (normalizedTitle.includes('EXPERIENCE') || normalizedTitle.includes('EDUCATION'))) {
    guessedType = normalizedTitle.includes('EDUCATION') ? 'education' : 'experience';
    if (guessedType === 'education') {
      entry.degree = parts[0] || '';
      entry.university = parts[1] || '';
      entry.location = parts[2] || '';
      entry.dates = parts[3] || '';
    } else {
      entry.title = parts[0] || '';
      entry.company = parts[1] || '';
      entry.location = parts[2] || '';
      entry.dates = parts[3] || '';
    }
    entry.spacing = { header: { before: false, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } };
  } else if (parts.length === 2) {
    guessedType = 'standard_one_headline';
    entry.headline1_left = parts[0] || '';
    entry.headline1_right = parts[1] || '';
    entry.spacing = { header1: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } };
  } else {
    guessedType = 'standard_bullets_only';
    entry.desc = parts.join(', ');
    entry.spacing = { desc: { before: true, after: true, ultra_tight: false } };
  }

  return { data: entry, guessedType };
};


// Main parsing function that converts a Markdown string into the application's state object.
const parseMarkdownToState = (mdContent) => {
  const blocks = mdContent.split(/\n## /);
  if (blocks.length < 2) {
    alert("Invalid Markdown format. Could not find any sections (e.g., '## EXPERIENCE').");
    return null;
  }

  const initialState = {
    name: "", title: "", email: "", phone: "", linkedin: "", github: "", location: "",
    page_margins: 1.0, file_name: 'Imported_Resume',
    spacing: { name: { before: false, after: false }, title: { before: false, after: false }, contact: { before: false, after: true } },
    sections: [],
  };

  // Block 1: Header
  const headerLines = blocks[0].split('\n').filter(Boolean);
  initialState.name = headerLines[0]?.replace('# ', '').trim() || '';
  initialState.title = headerLines[1]?.replace('### ', '').trim() || '';
  const contactLine = headerLines[2] || '';
  initialState.email = (contactLine.match(/[\w.-]+@[\w.-]+/) || [''])[0];
  initialState.phone = (contactLine.match(/\+?\d{1,3}?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/) || [''])[0];
  contactLine.split('|').forEach(part => {
    const p = part.trim();
    if (p.toLowerCase().includes('github.com')) initialState.github = p;
    else if (p.toLowerCase().includes('relocate')) initialState.location = p;
  });

  // Blocks 2+: Sections
  for (let i = 1; i < blocks.length; i++) {
    const sectionLines = blocks[i].split('\n').filter(Boolean);
    const sectionTitle = sectionLines.shift()?.trim() || 'UNTITLED';

    const section = {
      id: uuidv4(), title: sectionTitle.toUpperCase(), type: 'standard_one_headline',
      spacing: { title: { before: true, after: false } }, content: [],
    };

    if (sectionLines.length === 0) { // Handle empty section
      section.type = 'standard_bullets_only';
      section.content.push({ id: uuidv4(), desc: '', spacing: { desc: { before: true, after: false } } });
      initialState.sections.push(section);
      continue;
    }

    // Special case for simple, single-line sections like 'Skills'
    if (sectionTitle.toUpperCase() === 'SKILLS' && sectionLines.length === 1) {
      section.type = 'standard_bullets_only';
      section.content.push({ id: uuidv4(), desc: sectionLines[0], spacing: { desc: { before: true, after: true, ultra_tight: false } } });
      initialState.sections.push(section);
      continue;
    }

    // Group lines into entries. An entry is assumed to start with '**'.
    const entryGroups = [];
    let currentGroup = [];
    sectionLines.forEach(line => {
      if (line.startsWith('**') && currentGroup.length > 0) {
        entryGroups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(line);
    });
    if (currentGroup.length > 0) entryGroups.push(currentGroup);

    // Process each entry group
    let sectionTypeDetermined = false;
    entryGroups.forEach(group => {
      const headline = group.shift() || '';
      const desc = group.join('\n');
      const parts = headline.split('|').map(p => p.replace(/\*+/g, '').trim());

      const { data: entryData, guessedType } = createNewEntryFromParts(parts, sectionTitle);
      entryData.desc = desc;

      if (!sectionTypeDetermined) {
        section.type = guessedType; // Set the entire section's type based on the first entry
        sectionTypeDetermined = true;
      }
      section.content.push(entryData);
    });
    initialState.sections.push(section);
  }
  return initialState;
};
// --- END: ORIGINAL MARKDOWN PARSING LOGIC (RESTORED) ---


// Static CSS FOR PREVIEW AND EXPORT - UNCHANGED
const STATIC_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Times+New+Roman&display=swap');
body { 
  font-family: 'Times New Roman', serif; 
  background-color: #FFFFFF; 
  color: #000000; 
  font-size: 11pt; 
  line-height: 1.3; 
  margin: 0; 
  padding: 0;
  width: 100%;
  box-sizing: border-box;
}
.container { 
  width: 8.5in; 
  min-height: 11in; 
  margin: 0; 
  padding: 0; 
  background-color: #FFFFFF; 
  box-sizing: border-box; 
}
h1 { 
  text-align: center; 
  font-size: 24pt; 
  font-weight: bold; 
  margin: 0; 
  padding: 0 0 2px 0; 
}
.professional-title { 
  text-align: center; 
  font-size: 14pt; 
  margin: 0; 
  padding: 0 0 2px 0; 
}
.contact-info { 
  text-align: center; 
  font-size: 10pt; 
  margin: 0; 
  padding: 0 0 2px 0; 
  white-space: nowrap; 
}
.section-title { 
  border-bottom: 1.5px solid #000000; 
  padding-bottom: 2px; 
  font-size: 12pt; 
  font-weight: bold; 
  text-transform: uppercase; 
  margin: 0; 
}
.item-header { 
  display: flex; 
  justify-content: space-between; 
  font-weight: bold; 
  font-size: 11pt; 
  margin: 0; 
  padding: 0; 
}
.item-subheader { 
  display: flex; 
  justify-content: space-between; 
  font-style: italic; 
  font-size: 11pt; 
  margin: 0; 
  padding: 0; 
}
.item-desc { 
  margin: 0; 
  padding: 0; 
}
.item-desc ul { 
  padding-left: 18px; 
  list-style-position: outside; 
  margin: 0; 
}
li { 
  margin: 0; 
  padding: 0; 
}
p { 
  margin: 0; 
  padding: 0; 
}
.space-before { 
  margin-top: 12px; 
}
.space-after { 
  margin-bottom: 4px; 
}
.compact-before { 
  margin-top: 2px; 
}
.compact-after { 
  margin-bottom: 2px; 
}
.minimal-before { 
  margin-top: 0px; 
}
.minimal-after { 
  margin-bottom: 0px; 
}
.ultra-tight { 
  margin-top: -2px; 
  margin-bottom: 0px; 
}
.ultra-tight ul { 
  margin-top: 2px; 
}
`;

// --- START: UPDATED UI CSS WITH NEW COLOR THEME ---
const UI_CSS = `
  /* Main app theme */
  body {
    background-color: #2b2b2b;
    color: #ffebcd;
  }
  .app-container { display: flex; height: 100vh; }
  
  /* Sidebar, Edit, and Spacing Area styles */
  .sidebar, .edit-area, .spacing-area, .preview-area {
    background-color: #2b2b2b;
    color: #ffebcd;
    overflow-y: auto;
  }
  .sidebar { width: 300px; flex-shrink: 0; padding: 15px; border-right: 1px solid #4d4d4d; }
  .edit-area { flex: 1; padding: 15px; min-width: 450px; }
  .spacing-area { width: 250px; flex-shrink: 0; padding: 15px; border-left: 1px solid #4d4d4d; border-right: 1px solid #4d4d4d; }
  .preview-area { flex: 1; padding: 15px; min-width: 400px; }

  /* Main UI Headers */
  .sidebar h2, .edit-area h2, .spacing-area h2, .preview-area h2,
  .sidebar h3, .edit-area h3, .spacing-area h3, .preview-area h3 {
    background-color: #ffebcd;
    color: #000000;
    padding: 8px 12px;
    border-radius: 4px;
    margin-top: 20px;
    margin-bottom: 15px;
  }
  
  /* Widgets (Inputs, TextAreas, Selects) */
  input, select, textarea { 
    margin: 5px; 
    padding: 8px; 
    box-sizing: border-box;
    background-color: #4d4d4d;
    color: #ffebcd;
    border: 1px solid #636363;
    border-radius: 4px;
    width: 100%;
  }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: #ffebcd;
    box-shadow: 0 0 5px rgba(255, 235, 205, 0.5);
  }

  /* Buttons */
  button {
    margin: 5px; 
    padding: 8px 12px; 
    background-color: #4c4c4c;
    color: #ffebcd;
    border: 1px solid #ffebcd;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  button:hover {
    background-color: #636363;
    color: #ffffff;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: #4c4c4c;
    border-color: #636363;
    color: #ffebcd;
  }

  /* Section & Entry Containers in Edit Area */
  .section { border-bottom: 1px solid #4d4d4d; padding: 10px 0; }
  .entry { margin: 10px 0; padding: 10px; border: 1px solid #4d4d4d; border-radius: 4px; background-color: #3c3c3c; }
  .expander { border: 1px solid #4d4d4d; padding: 5px; margin: 5px 0; border-radius: 4px; }
  .expander summary { cursor: pointer; font-weight: bold; }

  /* Main content layout */
  .main-content { display: flex; flex-grow: 1; overflow-x: auto; }

  /* --- NEW: MARKDOWN TOOLBAR STYLES --- */
  .markdown-toolbar {
    background-color: #3c3c3c;
    padding: 2px 5px;
    border-radius: 4px 4px 0 0;
    border: 1px solid #4d4d4d;
    border-bottom: none;
    margin: 5px 5px -5px 5px; /* Align with textarea */
  }
  .markdown-toolbar button {
    margin: 2px;
    padding: 2px 6px;
    font-size: 14px;
    min-width: 30px;
    background-color: #4d4d4d;
    border: 1px solid #636363;
  }
  .markdown-toolbar button:hover {
    background-color: #ffebcd;
    color: #000000;
  }
  textarea.markdown-input {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  /* --- END: MARKDOWN TOOLBAR STYLES --- */

  /* --- CRITICAL --- This ensures the resume preview remains white */
  .preview-content-wrapper {
    border: 1px solid #4d4d4d;
    background-color: #FFFFFF; /* Ensure wrapper has a solid background */
  }
  .preview-content-wrapper .container {
    background-color: #FFFFFF !important;
    color: #000000 !important;
  }
`;
// --- END: UPDATED UI CSS ---


// --- START: NEW MARKDOWN TEXTAREA COMPONENT ---
const MarkdownTextArea = ({ value, onChange, ...props }) => {
  const textAreaRef = useRef(null);

  const applyFormatting = (formatType) => {
    const textArea = textAreaRef.current;
    if (!textArea) return;

    const start = textArea.selectionStart;
    const end = textArea.selectionEnd;
    const selectedText = value.substring(start, end);

    if (!selectedText) {
      alert("Please select the text you want to format.");
      return;
    }

    let markdown;
    if (formatType === 'bold') {
      markdown = `**${selectedText}**`;
    } else if (formatType === 'italic') {
      markdown = `*${selectedText}*`;
    } else if (formatType === 'link') {
      const url = prompt('Enter the URL:', 'https');
      if (!url) return; // User cancelled
      markdown = `[${selectedText}](${url})`;
    } else {
      return;
    }

    const newValue = `${value.substring(0, start)}${markdown}${value.substring(end)}`;
    onChange({ target: { value: newValue } }); // Mimic event object
  };

  return (
    <div>
      <div className="markdown-toolbar">
        <button type="button" onClick={() => applyFormatting('bold')} title="Bold"><b>B</b></button>
        <button type="button" onClick={() => applyFormatting('italic')} title="Italic"><i>I</i></button>
        <button type="button" onClick={() => applyFormatting('link')} title="Link">🔗</button>
      </div>
      <textarea
        ref={textAreaRef}
        value={value}
        onChange={onChange}
        className="markdown-input"
        {...props}
      />
    </div>
  );
};
// --- END: NEW MARKDOWN TEXTAREA COMPONENT ---


// Main App Component
const App = () => {
  const [resumeData, setResumeData] = useState({
    name: "Your Name",
    title: "Professional Title",
    email: "your.email@example.com",
    phone: "+1 (123) 456-7890",
    linkedin: "linkedin.com/in/yourprofile",
    github: "github.com/yourusername",
    location: "City, ST",
    page_margins: 1.0,
    file_name: 'Your_Name_Resume',
    spacing: {
      name: { before: false, after: false },
      title: { before: false, after: false },
      contact: { before: false, after: true },
    },
    sections: [
      {
        id: uuidv4(),
        title: 'EXPERIENCE',
        type: 'experience',
        spacing: { title: { before: true, after: false } },
        content: [
          {
            id: uuidv4(),
            title: 'Job Title',
            company: 'Company Name',
            dates: 'Month Year - Present',
            location: 'City, ST',
            desc: '- Placeholder bullet point describing a key achievement or responsibility.\n- Another placeholder bullet point detailing a specific contribution.\n- A third placeholder bullet point to demonstrate impact.',
            spacing: { header: { before: false, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } }
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'PROJECTS',
        type: 'standard_one_headline',
        spacing: { title: { before: true, after: false } },
        content: [
          {
            id: uuidv4(),
            headline1_left: 'Project Name',
            headline1_right: 'Month Year - Present',
            desc: '- Placeholder bullet point describing the project\'s purpose and your role.\n- Another placeholder bullet point explaining the technology used to build it.\n- A third placeholder bullet point highlighting the outcome or key features.',
            spacing: { header1: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } },
            keywords: 'Tech, Keyword, Skill'
          },
          {
            id: uuidv4(),
            headline1_left: 'Another Project',
            headline1_right: 'Month Year - Month Year',
            desc: '- Placeholder bullet point for your second project.',
            spacing: { header1: { before: true, after: false }, desc: { before: false, after: true, ultra_tight: true } },
            keywords: 'Tech, Keyword, Skill'
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'SKILLS',
        type: 'standard_bullets_only',
        spacing: { title: { before: true, after: false } },
        content: [
          {
            id: uuidv4(),
            desc: 'Placeholder for skills. You can list technologies, languages, or tools here.',
            spacing: { desc: { before: true, after: false } }
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'EDUCATION',
        type: 'education',
        spacing: { title: { before: true, after: false } },
        content: [
          {
            id: uuidv4(),
            degree: 'Degree or Certification',
            university: 'Institution Name',
            dates: 'Month Year',
            location: 'City, ST',
            desc: '— *Optional: Relevant Courses, GPA, or Honors*',
            spacing: { header: { before: false, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: false, ultra_tight: true } }
          }
        ]
      },
      {
        id: uuidv4(),
        title: 'VOLUNTEERING',
        type: 'standard_one_headline',
        spacing: { title: { before: true, after: false } },
        content: [
          {
            id: uuidv4(),
            headline1_left: 'Volunteer Role',
            headline1_right: 'Month Year - Month Year',
            desc: '- Placeholder bullet point describing your volunteer responsibilities and contributions.',
            spacing: { header1: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } },
            keywords: 'Organization Name ............................................................................................................................ Location'
          }
        ]
      }
    ]
  });
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = STATIC_CSS + UI_CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // --- START: NEW FILE IMPORT HANDLER ---
  const handleFileImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      try {
        const newState = parseMarkdownToState(content);
        if (newState) {
          newState.file_name = file.name.replace(/\.md$/, '_imported');
          setResumeData(newState);
          alert('Resume imported successfully!');
        }
      } catch (error) {
        console.error("Failed to parse Markdown file:", error);
        alert(`An error occurred while parsing the Markdown file: ${error.message}`);
      }
    };
    reader.onerror = () => {
      alert("Failed to read the selected file.");
    };
    reader.readAsText(file);

    // Reset the input value to allow re-uploading the same file
    event.target.value = null;
  };
  // --- END: NEW FILE IMPORT HANDLER ---


  // Update handlers
  const updateData = (key, value) => {
    setResumeData(prev => ({ ...prev, [key]: value }));
  };

  const updateSpacing = (path, value) => {
    setResumeData(prev => {
      const newSpacing = { ...prev.spacing };
      let current = newSpacing;
      path.slice(0, -1).forEach(p => {
        current = current[p];
      });
      current[path[path.length - 1]] = value;
      return { ...prev, spacing: newSpacing };
    });
  };

  const updateSection = (sectionId, key, value) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId ? { ...s, [key]: value } : s
      )
    }));
  };

  const updateSectionSpacing = (sectionId, path, value) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(s => {
        if (s.id === sectionId) {
          const newSpacing = { ...s.spacing };
          let current = newSpacing;
          path.slice(0, -1).forEach(p => {
            current = current[p] = { ...current[p] };
          });
          current[path[path.length - 1]] = value;
          return { ...s, spacing: newSpacing };
        }
        return s;
      })
    }));
  };

  const updateItem = (sectionId, itemId, key, value) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            content: s.content.map(i =>
              i.id === itemId ? { ...i, [key]: value } : i
            )
          };
        }
        return s;
      })
    }));
  };

  const updateItemSpacing = (sectionId, itemId, path, value) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            content: s.content.map(i => {
              if (i.id === itemId) {
                const newSpacing = { ...i.spacing };
                let current = newSpacing;
                path.slice(0, -1).forEach(p => {
                  current = current[p] = { ...current[p] };
                });
                current[path[path.length - 1]] = value;
                return { ...i, spacing: newSpacing };
              }
              return i;
            })
          };
        }
        return s;
      })
    }));
  };

  // Add section
  const addSection = (type) => {
    const newId = uuidv4();
    const defaultSpacing = { title: { before: true, after: false } };
    let newContent = [];
    let newSection = { id: newId, title: 'New Section', type, spacing: defaultSpacing };

    switch (type) {
      case 'experience':
        newSection.title = 'EXPERIENCE';
        newContent.push({ id: uuidv4(), title: 'New Job Title', company: 'Company', dates: 'Date Range', location: 'Location', desc: '- New description.', spacing: { header: { before: true, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } } });
        break;
      case 'education':
        newSection.title = 'EDUCATION';
        newContent.push({ id: uuidv4(), degree: 'New Degree', university: 'University', dates: 'Date', location: 'Location', desc: '', spacing: { header: { before: true, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } } });
        break;
      case 'standard_full':
        newContent.push({ id: uuidv4(), headline1_left: 'New Headline 1', headline1_right: 'Date', headline2_left: 'New Headline 2', headline2_right: 'Location', desc: '- New description.', spacing: { header1: { before: true, after: false }, header2: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } } });
        break;
      case 'standard_one_headline':
        newContent.push({ id: uuidv4(), headline1_left: 'New Headline', headline1_right: 'Date', desc: '- New description.', spacing: { header1: { before: true, after: false }, desc: { before: false, after: true, ultra_tight: true } } });
        break;
      case 'standard_bullets_only':
        newContent.push({ id: uuidv4(), desc: '- New bullet point.', spacing: { desc: { before: true, after: true, ultra_tight: false } } });
        break;
      case 'text':
        newSection.spacing = { ...defaultSpacing, content: { before: false, after: true } };
        newSection.content = 'New text block. You can edit this summary.';
        setResumeData(prev => ({ ...prev, sections: [...prev.sections, newSection] }));
        return; // Early return for text type
      default:
        return; // Do nothing for unknown types
    }
    newSection.content = newContent;
    setResumeData(prev => ({ ...prev, sections: [...prev.sections, newSection] }));
  };


  // Move section up/down
  const moveSection = (sectionId, direction) => {
    setResumeData(prev => {
      const sections = [...prev.sections];
      const index = sections.findIndex(s => s.id === sectionId);
      if (direction === 'up' && index > 0) {
        [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
      } else if (direction === 'down' && index < sections.length - 1) {
        [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
      }
      return { ...prev, sections };
    });
  };

  // Remove section
  const removeSection = (sectionId) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== sectionId)
    }));
  };

  // --- START: CORRECTED AND IMPROVED FUNCTIONS ---

  // Add entry to section
  const addEntry = (sectionId) => {
    setResumeData(prev => {
      const newSections = prev.sections.map(section => {
        if (section.id === sectionId) {
          const newEntry = { id: uuidv4() };
          // --- IMPROVEMENT: Add placeholder data to new entries ---
          switch (section.type) {
            case 'experience':
              newEntry.title = 'New Job Title'; newEntry.company = 'Company'; newEntry.dates = 'Date Range'; newEntry.location = 'Location'; newEntry.desc = '- New description.';
              newEntry.spacing = { header: { before: true, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } };
              break;
            case 'education':
              newEntry.degree = 'New Degree'; newEntry.university = 'University'; newEntry.dates = 'Date'; newEntry.location = 'Location'; newEntry.desc = '';
              newEntry.spacing = { header: { before: true, after: false }, subheader: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } };
              break;
            case 'standard_full':
              newEntry.headline1_left = 'New Headline 1'; newEntry.headline1_right = 'Date'; newEntry.headline2_left = 'New Headline 2'; newEntry.headline2_right = 'Location'; newEntry.desc = '- New description.';
              newEntry.spacing = { header1: { before: true, after: false }, header2: { before: false, after: false }, desc: { before: false, after: true, ultra_tight: true } };
              break;
            case 'standard_one_headline':
              newEntry.headline1_left = 'New Headline'; newEntry.headline1_right = 'Date'; newEntry.desc = '- New description.';
              newEntry.spacing = { header1: { before: true, after: false }, desc: { before: false, after: true, ultra_tight: true } };
              break;
            case 'standard_bullets_only':
              newEntry.desc = '- New bullet point.';
              newEntry.spacing = { desc: { before: true, after: true, ultra_tight: false } };
              break;
            default:
              return section;
          }
          return { ...section, content: [...section.content, newEntry] };
        }
        return section;
      });
      return { ...prev, sections: newSections };
    });
  };

  // Remove last entry
  const removeLastEntry = (sectionId) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(section => {
        if (section.id === sectionId && Array.isArray(section.content) && section.content.length > 1) {
          return { ...section, content: section.content.slice(0, -1) };
        }
        return section;
      })
    }));
  };

  // Move entry up/down
  const moveEntry = (sectionId, itemId, direction) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(section => {
        if (section.id === sectionId && Array.isArray(section.content)) {
          const content = [...section.content];
          const index = content.findIndex(i => i.id === itemId);

          if (direction === 'up' && index > 0) {
            [content[index - 1], content[index]] = [content[index], content[index - 1]];
          } else if (direction === 'down' && index < content.length - 1) {
            [content[index], content[index + 1]] = [content[index + 1], content[index]];
          }
          return { ...section, content };
        }
        return section;
      })
    }));
  };

  // --- END: CORRECTED AND IMPROVED FUNCTIONS ---

  // Sort entries by date
  const sortEntries = (sectionId) => {
    setResumeData(prev => ({
      ...prev,
      sections: prev.sections.map(section => {
        if (section.id === sectionId && Array.isArray(section.content)) {
          const content = [...section.content];
          content.sort((a, b) => {
            const [ya, ma] = getSortableDate(a);
            const [yb, mb] = getSortableDate(b);
            return yb - ya || mb - ma; // Descending
          });
          return { ...section, content };
        }
        return section;
      })
    }));
  };


  // Generate HTML for preview or PDF
  const generateHtmlResume = (data, forPdf = false) => {
    const containerStyle = `padding: ${data.page_margins}in;`;
    const contactInfo = [data.email, data.phone, data.github, data.linkedin, data.location]
      .filter(Boolean)
      .map(item => cleanText(item))
      .join(' | ');

    let html = `<html><head><style>${STATIC_CSS}</style></head><body><div class="container" style="${containerStyle}">`;
    html += `<h1 class="${getSpacingClasses(data.spacing.name)}">${cleanText(data.name)}</h1>`;
    if (data.title) html += `<div class="professional-title ${getSpacingClasses(data.spacing.title)}">${cleanText(data.title)}</div>`;
    html += `<div class="contact-info ${getSpacingClasses(data.spacing.contact)}">${contactInfo}</div>`;

    data.sections.forEach(section => {
      html += `<div class="section-title ${getSpacingClasses(section.spacing.title)}">${cleanText(section.title)}</div>`;
      if (section.type === 'text') {
        html += `<div class="${getSpacingClasses(section.spacing.content || {})}">${marked.parse(section.content)}</div>`;
      } else if (Array.isArray(section.content)) {
        section.content.forEach(item => {
          const s = item.spacing;
          if (section.type === 'experience') {
            html += `<div class="item-header ${getSpacingClasses(s.header)}"><span>${cleanText(item.title)}</span><span>${cleanText(item.dates)}</span></div>`;
            html += `<div class="item-subheader ${getSpacingClasses(s.subheader)}"><span>${cleanText(item.company)}</span><span>${cleanText(item.location || '')}</span></div>`;
            html += `<div class="item-desc ${getSpacingClasses(s.desc, true)}">${marked.parse(item.desc)}</div>`;
          } else if (section.type === 'education') {
            html += `<div class="item-header ${getSpacingClasses(s.header)}"><span>${cleanText(item.degree)}</span><span>${cleanText(item.dates)}</span></div>`;
            html += `<div class="item-subheader ${getSpacingClasses(s.subheader)}"><span>${cleanText(item.university)}</span><span>${cleanText(item.location || '')}</span></div>`;
            html += `<div class="item-desc ${getSpacingClasses(s.desc, true)}">${marked.parse(item.desc || '')}</div>`;
          } else if (section.type === 'standard_full') {
            html += `<div class="item-header ${getSpacingClasses(s.header1)}"><span>${cleanText(item.headline1_left)}</span><span>${cleanText(item.headline1_right)}</span></div>`;
            html += `<div class="item-subheader ${getSpacingClasses(s.header2)}"><span>${cleanText(item.headline2_left)}</span><span>${cleanText(item.headline2_right)}</span></div>`;
            html += `<div class="item-desc ${getSpacingClasses(s.desc, true)}">${marked.parse(item.desc)}</div>`;
          } else if (section.type === 'standard_one_headline') {
            html += `<div class="item-header ${getSpacingClasses(s.header1)}"><span>${cleanText(item.headline1_left)}</span><span>${cleanText(item.headline1_right)}</span></div>`;
            html += `<div class="item-desc ${getSpacingClasses(s.desc, true)}">${marked.parse(item.desc)}</div>`;
          } else if (section.type === 'standard_bullets_only') {
            html += `<div class="item-desc ${getSpacingClasses(s.desc, true)}">${marked.parse(item.desc)}</div>`;
          }
        });
      }
    });
    html += `</div></body></html>`;
    return html;
  };

  // --- START: FINAL SERVER-SIDE PDF GENERATION WITH ROBUST ERROR HANDLING ---
  const generatePDF = async () => {
    const resumeHtml = generateHtmlResume(resumeData, true); // Use forPdf flag for clean HTML
    try {
        const response = await fetch('/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: resumeHtml }),
        });

        if (!response.ok) {
            // New robust error handling: check if the response is JSON or something else (like an HTML error page)
            const contentType = response.headers.get('content-type');
            let errorMessage;
            if (contentType && contentType.includes('application/json')) {
                const errorData = await response.json();
                errorMessage = errorData.message || 'PDF generation failed on the server.';
            } else {
                // This handles cases where the serverless function crashes and returns an HTML error page.
                errorMessage = "Server error: The PDF generation service is not responding correctly. Please check the serverless function logs for more details.";
            }
            throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${resumeData.file_name}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

    } catch (error) {
        console.error('Error generating PDF:', error);
        alert(`An error occurred: ${error.message}`);
    }
  };
  // --- END: FINAL SERVER-SIDE PDF GENERATION ---

  // --- START: UPDATED DOCX GENERATION WITH UNIVERSAL MARKDOWN SUPPORT ---
  const generateDOCX = async () => {
    const doc = new Document({
      styles: {
        characterStyles: [{
          id: 'Hyperlink',
          name: 'Hyperlink',
          basedOn: 'Normal',
          run: {
            color: '0000FF',
            underline: { type: 'single', color: '0000FF' },
          },
        }],
        paragraphStyles: [
          {
            id: 'Normal',
            name: 'Normal',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              font: 'Times New Roman',
              size: 22, // 11pt
            }
          },
          {
            id: 'Title',
            name: 'Title',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              size: 48, // 24pt
              bold: true,
            }
          }
        ]
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: resumeData.page_margins * 1440,
              bottom: resumeData.page_margins * 1440,
              left: resumeData.page_margins * 1440,
              right: resumeData.page_margins * 1440
            }
          }
        },
        children: []
      }]
    });

    const applySpacing = (paragraph, spacingDict, isDesc = false) => {
      if (isDesc && spacingDict.ultra_tight) {
        paragraph.spacing({ before: 0, after: 0 });
      } else {
        paragraph.spacing({
          before: spacingDict.before ? 240 : 40,
          after: spacingDict.after ? 120 : 40
        });
      }
    };

    const parseMarkdownToDocxRuns = (text = "", baseStyle = {}) => {
        if (!text) return [new TextRun({ text: "", ...baseStyle })];

        const children = [];
        const tokens = text.split(/(\[.*?\]\(.*?\))/g).filter(Boolean);

        tokens.forEach(token => {
            const linkMatch = token.match(/\[(.*?)\]\((.*?)\)/);
            if (linkMatch) {
                children.push(
                    new ExternalHyperlink({
                        link: linkMatch[2],
                        children: [new TextRun({ text: linkMatch[1], style: "Hyperlink", ...baseStyle })],
                    })
                );
            } else {
                const subTokens = token.split(/(\*\*.*?\*\*|\*.*?\*)/g).filter(Boolean);
                subTokens.forEach(subToken => {
                    if (subToken.startsWith('**') && subToken.endsWith('**')) {
                        children.push(new TextRun({ text: subToken.slice(2, -2), ...baseStyle, bold: true }));
                    } else if (subToken.startsWith('*') && subToken.endsWith('*')) {
                        children.push(new TextRun({ text: subToken.slice(1, -1), ...baseStyle, italics: true }));
                    } else {
                        children.push(new TextRun({ text: subToken, ...baseStyle }));
                    }
                });
            }
        });
        return children;
    };

    const addDualLine = (textLeft, textRight, spacing, styleLeft = {}, styleRight = {}) => {
        const leftRuns = parseMarkdownToDocxRuns(textLeft, styleLeft);
        const rightRuns = parseMarkdownToDocxRuns(textRight, styleRight);

        const p = new Paragraph({
            children: [
                ...leftRuns,
                new TextRun({ text: "\t" }),
                ...rightRuns
            ],
            tabStops: [
                {
                    type: "right",
                    position: (8.5 - 2 * resumeData.page_margins) * 1440
                }
            ]
        });
        applySpacing(p, spacing);
        doc.addSection({ children: [p] });
    };

    const addBulletPoints = (descText, spacingDict) => {
        if (!descText) return;
        const points = descText.split('\n').filter(p => p.trim());
        points.forEach((point, i) => {
            const isBullet = point.trim().startsWith('-');
            const text = isBullet ? point.trim().slice(1).trim() : point.trim();
            const children = parseMarkdownToDocxRuns(text);

            const p = new Paragraph({
                children: children,
                bullet: isBullet ? { level: 0 } : undefined
            });

            if (i === 0) applySpacing(p, spacingDict, true);
            else p.spacing({ before: 0, after: 0 });
            doc.addSection({ children: [p] });
        });
    };

    // Header
    let p = new Paragraph({
      children: parseMarkdownToDocxRuns(resumeData.name, { size: 48 }),
      alignment: AlignmentType.CENTER
    });
    applySpacing(p, resumeData.spacing.name);
    doc.addSection({ children: [p] });

    if (resumeData.title) {
      p = new Paragraph({
        children: parseMarkdownToDocxRuns(resumeData.title, { size: 28 }),
        alignment: AlignmentType.CENTER
      });
      applySpacing(p, resumeData.spacing.title);
      doc.addSection({ children: [p] });
    }

    const contactFields = [resumeData.email, resumeData.phone, resumeData.github, resumeData.linkedin, resumeData.location].filter(Boolean);
    const contactChildren = [];
    contactFields.forEach((field, index) => {
        contactChildren.push(...parseMarkdownToDocxRuns(field, { size: 20 }));
        if (index < contactFields.length - 1) {
            contactChildren.push(new TextRun({ text: " | ", size: 20 }));
        }
    });

    p = new Paragraph({
        children: contactChildren,
        alignment: AlignmentType.CENTER,
    });
    applySpacing(p, resumeData.spacing.contact);
    doc.addSection({ children: [p] });

    // Sections
    resumeData.sections.forEach(section => {
        const titleRuns = parseMarkdownToDocxRuns(section.title.toUpperCase(), { bold: true, size: 24 });
        const table = new Table({
            rows: [
                new TableRow({
                    children: [
                        new TableCell({
                            children: [new Paragraph({ children: titleRuns })],
                            borders: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' } },
                            margins: { top: 0, bottom: 0, left: 0, right: 0 },
                            verticalAlign: VerticalAlign.CENTER
                        })
                    ]
                })
            ],
            width: { size: 100, type: WidthType.PERCENTAGE }
        });
        const titleP = table.root[0].root[0].root[0];
        applySpacing(titleP, section.spacing.title);
        doc.addSection({ children: [table] });

        if (section.type === 'text') {
            addBulletPoints(section.content, section.spacing.content || {});
        } else {
            section.content.forEach(item => {
                const s = item.spacing;
                switch (section.type) {
                    case 'experience':
                        addDualLine(item.title, item.dates, s.header, { bold: true }, { bold: true });
                        addDualLine(item.company, item.location || '', s.subheader, { italics: true }, { italics: true });
                        addBulletPoints(item.desc, s.desc);
                        break;
                    case 'education':
                        addDualLine(item.degree, item.dates, s.header, { bold: true }, { bold: true });
                        addDualLine(item.university, item.location || '', s.subheader, { italics: true }, { italics: true });
                        addBulletPoints(item.desc || '', s.desc);
                        break;
                    case 'standard_full':
                        addDualLine(item.headline1_left, item.headline1_right, s.header1, { bold: true }, { bold: true });
                        addDualLine(item.headline2_left, item.headline2_right, s.header2, { italics: true }, { italics: true });
                        addBulletPoints(item.desc, s.desc);
                        break;
                    case 'standard_one_headline':
                        addDualLine(item.headline1_left, item.headline1_right, s.header1, { bold: true }, { bold: true });
                        addBulletPoints(item.desc, s.desc);
                        break;
                    case 'standard_bullets_only':
                        addBulletPoints(item.desc, s.desc);
                        break;
                    default:
                        break;
                }
            });
        }
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resumeData.file_name}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  // --- END: UPDATED DOCX GENERATION ---

  // Generate Markdown
  const generateMarkdown = () => {
    let md = `# ${resumeData.name}\n`;
    if (resumeData.title) md += `### ${resumeData.title}\n`;
    const contactInfo = [resumeData.email, resumeData.phone, resumeData.github, resumeData.linkedin, resumeData.location].filter(Boolean).join(' | ');
    md += `${contactInfo}\n\n`;
    resumeData.sections.forEach(section => {
      md += `## ${section.title}\n`;
      if (section.type === 'text') {
        md += `${section.content}\n\n`;
      } else {
        section.content.forEach(item => {
          switch (section.type) {
            case 'experience':
              md += `**${item.title}** | *${item.company}* | *${item.location || ''}* | **${item.dates}**\n${item.desc}\n\n`;
              break;
            case 'education':
              md += `**${item.degree}** | *${item.university}* | *${item.location || ''}* | **${item.dates}**\n${item.desc || ''}\n\n`;
              break;
            case 'standard_full':
              md += `**${item.headline1_left}** | **${item.headline1_right}**\n*${item.headline2_left}* | *${item.headline2_right}*\n${item.desc}\n\n`;
              break;
            case 'standard_one_headline':
              md += `**${item.headline1_left}** | **${item.headline1_right}**\n${item.desc}\n\n`;
              break;
            case 'standard_bullets_only':
              md += `${item.desc}\n\n`;
              break;
            default:
              break;
          }
        });
      }
    });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resumeData.file_name}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Render UI
  return (
    <div className="app-container">
      {/* Sidebar Controls */}
      <div className="sidebar">
        <h2>Controls</h2>
        <label>
          Show Live Preview
          <input type="checkbox" checked={showPreview} onChange={e => setShowPreview(e.target.checked)} />
        </label>
        <h3>Page Margins</h3>
        <select value={resumeData.page_margins} onChange={e => updateData('page_margins', parseFloat(e.target.value))}>
          <option value={1.0}>Normal (1.0 inch)</option>
          <option value={0.5}>Narrow (0.5 inch)</option>
        </select>
        <h3>Manage Sections</h3>
        <select id="sectionType">
          <option value="experience">Experience</option>
          <option value="education">Education</option>
          <option value="standard_one_headline">Standard (One Headline & Bullets)</option>
          <option value="standard_full">Standard (Two Headlines & Bullets)</option>
          <option value="standard_bullets_only">Standard (Bullets Only)</option>
          <option value="text">Text/Summary</option>
        </select>
        <button onClick={() => addSection(document.getElementById('sectionType').value)}>Add New Section</button>
        <h3>Download</h3>
        <input type="text" value={resumeData.file_name} onChange={e => updateData('file_name', e.target.value)} />
        <button onClick={generatePDF}>⬇️ Download PDF</button>
        <button onClick={generateDOCX}>⬇️ Download Word</button>
        <button onClick={generateMarkdown}>⬇️ Download MD</button>
        <h3>Import Resume</h3>
        <p style={{ fontSize: '0.8em', margin: '0 0 5px 0' }}>Import from a .md file. (PDF import is not currently supported).</p>
        <input type="file" accept=".md, .markdown" onChange={handleFileImport} />
      </div>

      <div className="main-content">
        {/* Edit Area */}
        <div className="edit-area">
          <h2>Contact Information</h2>
          <p style={{ fontSize: '0.8em', margin: '0 0 10px 5px' }}>You can use Markdown (e.g., **bold**, *italic*, [link](url)) in these fields.</p>
          <div style={{ display: 'flex' }}>
            <input type="text" value={resumeData.name} onChange={e => updateData('name', e.target.value)} placeholder="Full Name" style={{ flex: 1 }} />
            <input type="text" value={resumeData.title} onChange={e => updateData('title', e.target.value)} placeholder="Professional Title (optional)" style={{ flex: 1 }}/>
          </div>
          <div style={{ display: 'flex' }}>
            <input type="text" value={resumeData.email} onChange={e => updateData('email', e.target.value)} placeholder="Email" style={{ flex: 1 }} />
            <input type="text" value={resumeData.phone} onChange={e => updateData('phone', e.target.value)} placeholder="Phone" style={{ flex: 1 }} />
            <input type="text" value={resumeData.location} onChange={e => updateData('location', e.target.value)} placeholder="Location" style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex' }}>
            <input type="text" value={resumeData.linkedin} onChange={e => updateData('linkedin', e.target.value)} placeholder="LinkedIn URL (optional)" style={{ flex: 1 }} />
            <input type="text" value={resumeData.github} onChange={e => updateData('github', e.target.value)} placeholder="GitHub URL (optional)" style={{ flex: 1 }} />
          </div>

          <h2>Resume Sections</h2>
          <p style={{ fontSize: '0.8em', margin: '0 0 10px 5px' }}>You can use Markdown (e.g., **bold**, *italic*, [link](url)) in any text field.</p>
          {resumeData.sections.map((section, i) => (
            <div key={section.id} className="section">
              <div style={{ display: 'flex' }}>
                <input type="text" value={section.title} onChange={e => updateSection(section.id, 'title', e.target.value)} style={{ flex: 1 }} />
                <button onClick={() => moveSection(section.id, 'up')} disabled={i === 0}>▲</button>
                <button onClick={() => moveSection(section.id, 'down')} disabled={i === resumeData.sections.length - 1}>▼</button>
                <button onClick={() => removeSection(section.id)}>⌫</button>
              </div>
              {section.type === 'text' ? (
                <MarkdownTextArea value={section.content} onChange={e => updateSection(section.id, 'content', e.target.value)} style={{ height: '100px' }} />
              ) : (
                section.content.map((item, j) => (
                  <div key={item.id} className="entry">
                    <div style={{ display: 'flex' }}>
                      <strong>Entry {j + 1}</strong>
                      <button onClick={() => moveEntry(section.id, item.id, 'up')} disabled={j === 0}>▲</button>
                      <button onClick={() => moveEntry(section.id, item.id, 'down')} disabled={j === section.content.length - 1}>▼</button>
                    </div>
                    {section.type === 'experience' && (
                      <>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.title} onChange={e => updateItem(section.id, item.id, 'title', e.target.value)} placeholder="Job Title" style={{ flex: 1 }} />
                          <input type="text" value={item.dates} onChange={e => updateItem(section.id, item.id, 'dates', e.target.value)} placeholder="Dates" style={{ flex: 1 }} />
                        </div>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.company} onChange={e => updateItem(section.id, item.id, 'company', e.target.value)} placeholder="Company" style={{ flex: 1 }} />
                          <input type="text" value={item.location} onChange={e => updateItem(section.id, item.id, 'location', e.target.value)} placeholder="Location" style={{ flex: 1 }} />
                        </div>
                        <MarkdownTextArea value={item.desc} onChange={e => updateItem(section.id, item.id, 'desc', e.target.value)} style={{ height: '120px' }} placeholder="Description (use '-' for bullets)" />
                      </>
                    )}
                    {section.type === 'education' && (
                      <>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.degree} onChange={e => updateItem(section.id, item.id, 'degree', e.target.value)} placeholder="Degree/Program" style={{ flex: 1 }} />
                          <input type="text" value={item.dates} onChange={e => updateItem(section.id, item.id, 'dates', e.target.value)} placeholder="Dates" style={{ flex: 1 }} />
                        </div>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.university} onChange={e => updateItem(section.id, item.id, 'university', e.target.value)} placeholder="Institution" style={{ flex: 1 }} />
                          <input type="text" value={item.location} onChange={e => updateItem(section.id, item.id, 'location', e.target.value)} placeholder="Location" style={{ flex: 1 }} />
                        </div>
                        <MarkdownTextArea value={item.desc} onChange={e => updateItem(section.id, item.id, 'desc', e.target.value)} style={{ height: '80px' }} placeholder="Description (optional, use '-' for bullets)" />
                      </>
                    )}
                    {section.type === 'standard_full' && (
                      <>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.headline1_left} onChange={e => updateItem(section.id, item.id, 'headline1_left', e.target.value)} placeholder="Headline Text" style={{ flex: 1 }} />
                          <input type="text" value={item.headline1_right} onChange={e => updateItem(section.id, item.id, 'headline1_right', e.target.value)} placeholder="Date" style={{ flex: 1 }} />
                        </div>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.headline2_left} onChange={e => updateItem(section.id, item.id, 'headline2_left', e.target.value)} placeholder="Sub-headline Text" style={{ flex: 1 }} />
                          <input type="text" value={item.headline2_right} onChange={e => updateItem(section.id, item.id, 'headline2_right', e.target.value)} placeholder="Location" style={{ flex: 1 }} />
                        </div>
                        <MarkdownTextArea value={item.desc} onChange={e => updateItem(section.id, item.id, 'desc', e.target.value)} style={{ height: '100px' }} placeholder="Description (use '-' for bullets)" />
                      </>
                    )}
                    {section.type === 'standard_one_headline' && (
                      <>
                        <div style={{ display: 'flex' }}>
                          <input type="text" value={item.headline1_left} onChange={e => updateItem(section.id, item.id, 'headline1_left', e.target.value)} placeholder="Headline Text" style={{ flex: 1 }} />
                          <input type="text" value={item.headline1_right} onChange={e => updateItem(section.id, item.id, 'headline1_right', e.target.value)} placeholder="Date" style={{ flex: 1 }} />
                        </div>
                        <MarkdownTextArea value={item.desc} onChange={e => updateItem(section.id, item.id, 'desc', e.target.value)} style={{ height: '100px' }} placeholder="Description (use '-' for bullets)" />
                      </>
                    )}
                    {section.type === 'standard_bullets_only' && (
                      <MarkdownTextArea value={item.desc} onChange={e => updateItem(section.id, item.id, 'desc', e.target.value)} style={{ height: '100px' }} placeholder="Description (use '-' for bullets)" />
                    )}
                  </div>
                ))
              )}
              {section.type !== 'text' && (
                <div style={{ display: 'flex' }}>
                  <button onClick={() => addEntry(section.id)}>Add Entry</button>
                  <button onClick={() => removeLastEntry(section.id)} disabled={!section.content || section.content.length <= 1}>Remove Last Entry</button>
                  {['experience', 'education', 'standard_full', 'standard_one_headline'].includes(section.type) && (
                    <button onClick={() => sortEntries(section.id)}>Sort by Date</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Spacing Controls */}
        <div className="spacing-area">
          <h2>Spacing</h2>
          <p>▲ Before | After ▼</p>
          <h3>Header</h3>
          <button onClick={() => {
            updateSpacing(['name', 'before'], false);
            updateSpacing(['name', 'after'], false);
            updateSpacing(['title', 'before'], false);
            updateSpacing(['title', 'after'], false);
            updateSpacing(['contact', 'before'], false);
            updateSpacing(['contact', 'after'], false);
          }}>Remove All Header Spacing</button>
          <label>
            ▲ Name <input type="checkbox" checked={resumeData.spacing.name.before} onChange={e => updateSpacing(['name', 'before'], e.target.checked)} />
          </label>
          <label>
            Name ▼ <input type="checkbox" checked={resumeData.spacing.name.after} onChange={e => updateSpacing(['name', 'after'], e.target.checked)} />
          </label>
          {resumeData.title && (
            <>
              <label>
                ▲ Title <input type="checkbox" checked={resumeData.spacing.title.before} onChange={e => updateSpacing(['title', 'before'], e.target.checked)} />
              </label>
              <label>
                Title ▼ <input type="checkbox" checked={resumeData.spacing.title.after} onChange={e => updateSpacing(['title', 'after'], e.target.checked)} />
              </label>
            </>
          )}
          <label>
            ▲ Contact <input type="checkbox" checked={resumeData.spacing.contact.before} onChange={e => updateSpacing(['contact', 'before'], e.target.checked)} />
          </label>
          <label>
            Contact ▼ <input type="checkbox" checked={resumeData.spacing.contact.after} onChange={e => updateSpacing(['contact', 'after'], e.target.checked)} />
          </label>
          {resumeData.sections.map(section => (
            <div key={section.id}>
              <hr />
              <strong>{section.title}</strong>
              <label>
                ▲ Sec. Title <input type="checkbox" checked={section.spacing.title.before} onChange={e => updateSectionSpacing(section.id, ['title', 'before'], e.target.checked)} />
              </label>
              <label>
                Sec. Title ▼ <input type="checkbox" checked={section.spacing.title.after} onChange={e => updateSectionSpacing(section.id, ['title', 'after'], e.target.checked)} />
              </label>
              {section.type === 'text' && (
                <>
                  <label>
                    ▲ Content <input type="checkbox" checked={section.spacing.content?.before || false} onChange={e => updateSectionSpacing(section.id, ['content', 'before'], e.target.checked)} />
                  </label>
                  <label>
                    Content ▼ <input type="checkbox" checked={section.spacing.content?.after || true} onChange={e => updateSectionSpacing(section.id, ['content', 'after'], e.target.checked)} />
                  </label>
                </>
              )}
              {section.content && Array.isArray(section.content) && section.content.map((item, i) => (
                <details key={item.id} className="expander">
                  <summary>Entry {i + 1} Spacing</summary>
                  {['experience', 'education'].includes(section.type) && (
                    <>
                      <p><strong>Header</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.header.before} onChange={e => updateItemSpacing(section.id, item.id, ['header', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.header.after} onChange={e => updateItemSpacing(section.id, item.id, ['header', 'after'], e.target.checked)} /></label>
                      <p><strong>Sub-header</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.subheader.before} onChange={e => updateItemSpacing(section.id, item.id, ['subheader', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.subheader.after} onChange={e => updateItemSpacing(section.id, item.id, ['subheader', 'after'], e.target.checked)} /></label>
                      <p><strong>Description</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.desc.before} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.desc.after} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'after'], e.target.checked)} /></label>
                      <label>Ultra Tight <input type="checkbox" checked={item.spacing.desc.ultra_tight} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'ultra_tight'], e.target.checked)} /></label>
                    </>
                  )}
                  {section.type === 'standard_full' && (
                    <>
                      <p><strong>Headline 1</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.header1.before} onChange={e => updateItemSpacing(section.id, item.id, ['header1', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.header1.after} onChange={e => updateItemSpacing(section.id, item.id, ['header1', 'after'], e.target.checked)} /></label>
                      <p><strong>Headline 2</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.header2.before} onChange={e => updateItemSpacing(section.id, item.id, ['header2', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.header2.after} onChange={e => updateItemSpacing(section.id, item.id, ['header2', 'after'], e.target.checked)} /></label>
                      <p><strong>Description</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.desc.before} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.desc.after} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'after'], e.target.checked)} /></label>
                      <label>Ultra Tight <input type="checkbox" checked={item.spacing.desc.ultra_tight} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'ultra_tight'], e.target.checked)} /></label>
                    </>
                  )}
                  {section.type === 'standard_one_headline' && (
                    <>
                      <p><strong>Headline</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.header1.before} onChange={e => updateItemSpacing(section.id, item.id, ['header1', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.header1.after} onChange={e => updateItemSpacing(section.id, item.id, ['header1', 'after'], e.target.checked)} /></label>
                      <p><strong>Description</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.desc.before} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.desc.after} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'after'], e.target.checked)} /></label>
                      <label>Ultra Tight <input type="checkbox" checked={item.spacing.desc.ultra_tight} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'ultra_tight'], e.target.checked)} /></label>
                    </>
                  )}
                  {section.type === 'standard_bullets_only' && (
                    <>
                      <p><strong>Description</strong></p>
                      <label>▲ Before <input type="checkbox" checked={item.spacing.desc.before} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'before'], e.target.checked)} /></label>
                      <label>After ▼ <input type="checkbox" checked={item.spacing.desc.after} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'after'], e.target.checked)} /></label>
                      <label>Ultra Tight <input type="checkbox" checked={item.spacing.desc.ultra_tight} onChange={e => updateItemSpacing(section.id, item.id, ['desc', 'ultra_tight'], e.target.checked)} /></label>
                    </>
                  )}
                </details>
              ))}
            </div>
          ))}
        </div>

        {/* Live Preview */}
        {showPreview && (
          <div className="preview-area">
            <h2>Live Preview</h2>
            <p>Your edits are now applied to the preview automatically as you type.</p>
            <div className="preview-content-wrapper" dangerouslySetInnerHTML={{ __html: generateHtmlResume(resumeData) }} style={{ height: '800px', overflow: 'auto' }} />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;