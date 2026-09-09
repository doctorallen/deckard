---
tags: [management/performance, project-name]
---

# Tag scenario lab

This note keeps representative tag syntax together for the development
workspace and Dashboard.

## Ghostline relay #management/performance #project/ghostline-relay #org/echo-foundry

### Lightweight tags

These ordinary labels stay outside the entity list:

- [ ] Review the sample tag flow #project-name #follow-up
- [ ] Rename the candidate tag when testing `Deckard: Rename Tag` #rename-candidate

### Custom namespaces and aliases

The development workspace maps these custom namespaces to management:

#management/performance #leadership/performance #operations/performance

They should collapse into one `Management: Performance` entity while the
source labels remain visible where they were written.

### Plain Markdown headings

This heading has no tag and should remain an ordinary heading.

#### #topic/quantum-drift

##### #risk/thermal-leak

###### #operations/performance

The tag-only headings above exercise H4, H5, and H6 source locations.

### Untagged calibration notes

#### Signal lock #topic/quantum-drift #risk/thermal-leak

The tagged signal heading is nested below an untagged heading, so its nearest
tagged ancestor remains the Ghostline relay. Multiple tags on either heading
exercise every parent/child combination in Tag Overview.

```markdown
#### #ignored-in-fenced-code
```
