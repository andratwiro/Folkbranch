/** What a family most often wants to hear. Picked with a press, kept in the person's own words otherwise. */
export const READY = ['Where were you born, and what was the house like?', 'How did you meet?', 'What did your parents do?', 'What do you remember of the war and evacuation?', 'Which story did the family always tell?', 'What would you like the grandchildren to remember?']

/** Adds the line to the questions, or takes it out when it is there; never more than five. */
export const toggleLine = (text: string, line: string) => {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean)
  return (lines.includes(line) ? lines.filter((x) => x !== line) : [...lines, line].slice(0, 5)).join('\n')
}
