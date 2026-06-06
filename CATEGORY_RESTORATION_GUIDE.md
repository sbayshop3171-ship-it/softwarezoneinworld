# Category Restoration Guide

## Overview
A new category restoration feature has been added to the admin panel to prevent accidental deletion of categories and allow easy restoration of all default categories.

## Features Added

### 1. **Restore All Categories Button**
Located in the "Manage Categories" section of the admin panel, this button restores all 31 default categories with a single click.

**Location:** Admin Panel → Manage Categories → "🔄 Restore All Categories" section

### 2. **How It Works**
- If any categories are missing or accidentally deleted, click the "Restore All Categories" button
- The system uses `INSERT OR IGNORE` so it won't overwrite existing categories
- Missing categories will be added back to the database
- A confirmation dialog appears before restoration to prevent accidental clicks

### 3. **31 Default Categories Restored**
The system maintains these categories:

**Group 1 (Original Custom):**
1. Social Media
2. Email Service
3. Information Service
4. Premium Apps
5. Facebook Hacking
6. NID ID Documentation

**Group 2 (Default Services - Part 1):**
7. Messenger
8. WhatsApp
9. Telegram
10. Instagram
11. File Manager
12. Gallery
13. IMO
14. TikTok
15. Remote
16. Phone Number
17. Google
18. Call
19. Support
20. Camera
21. Location
22. Gmail
23. Viber
24. Twitter
25. Landing
26. Microphone
27. Message

**Group 3 (Additional Services):**
28. Look file 🗄️
29. Free fire 🎮
30. YouTube
31. Facebook
32. Call recording
33. Video call recording
34. Full phone recording
35. Not internet call history
36. Not internet call recording
37. Not Internet access

## Technical Details

### Backend Implementation (`server.js`)
- **Endpoint:** `POST /api/admin/categories/restore-defaults`
- **Functionality:** Inserts all default categories using `INSERT OR IGNORE` to prevent duplicates
- **Response:** Returns number of restored and failed categories

### Frontend Implementation (`admin.html`)
- **Function:** `restoreAllCategories()`
- **Features:**
  - Confirmation dialog before restoration
  - Success notification after restoration
  - Automatic refresh of category list
  - Error handling and user feedback

### Database Protection
- Uses `INSERT OR IGNORE` to ensure categories can't be overwritten
- Existing categories with the same name are preserved
- New categories are only added if they don't exist

## Usage Instructions

### To Restore All Categories:
1. Go to Admin Panel
2. Navigate to "Manage Categories" section
3. Look for the orange "🔄 Restore All Categories" button
4. Click the button
5. Confirm the restoration in the popup dialog
6. Wait for the success notification
7. The category list will automatically refresh

### When to Use:
- When you notice categories are missing from the system
- After accidental deletion of one or more categories
- When setting up a fresh installation
- When maintaining consistency across instances

## Database Backup
A backup file `categories_backup.json` has been created with all current categories and their properties.

**Location:** `/categories_backup.json`

This file can be used for reference or recovery purposes if needed.

## Notes
- The restoration process only adds missing categories back
- Existing categories are never modified or deleted by this function
- All categories are marked as active (is_active = 1) upon restoration
- Categories maintain their original icons and descriptions
- Display order is preserved as per the original design

## Support
If you experience any issues with category restoration:
1. Check the browser console for error messages
2. Verify the server is running properly
3. Ensure the database.db file has proper permissions
4. Try refreshing the page and attempting restoration again
