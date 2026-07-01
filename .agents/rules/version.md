---
trigger: always_on
---

- Everytime you made any changes then according to that change update the native app version, like if the changes is small according to you then update the version name as per the change and if change is huge then update the app version name according to that change, also make sure to update the current updated version name in the app settings.

- Do not create any types of artifacts or plan, creates only when explicitly mentioned by the user.

- Every time you introduce a new feature or make updates, you must also update/implement the "What's New" modal to display the list of new features/updates, complete with a "Skip for now" and a "Get Started" button. When the user clicks "Get Started", the app must redirect them to that specific new/updated feature, and display a contextual walkthrough/tooltip tutorial with appropriate helper text and action buttons suitable for that feature.