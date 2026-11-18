/** What a family most often wants to hear. Picked with a press, kept in the person's own words otherwise. */
export const READY = ['Где вы родились и каким был дом?', 'Как вы познакомились?', 'Чем занимались ваши родители?', 'Что помните о войне и эвакуации?', 'Какую историю всегда рассказывали в семье?', 'Что вы хотите, чтобы помнили внуки?']

/** Adds the line to the questions, or takes it out when it is there; never more than five. */
export const toggleLine = (text: string, line: string) => {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean)
  return (lines.includes(line) ? lines.filter((x) => x !== line) : [...lines, line].slice(0, 5)).join('\n')
}
