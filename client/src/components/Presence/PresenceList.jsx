import { useAwarenessStates } from '../../hooks/useAwarenessStates';

export function PresenceList({ awareness, onSelectFile }) {
  const people = useAwarenessStates(awareness);
  if (people.length === 0) return null;

  return (
    <div className="presence-list">
      <div className="presence-heading">In this room · {people.length}</div>
      {people.map((person) => {
        const canJump = Boolean(person.activeFile) && !person.isSelf && onSelectFile;
        return (
          <div
            key={person.clientID}
            className={`presence-item${canJump ? ' presence-item-jumpable' : ''}`}
            title={
              person.activeFile
                ? `${person.user.name}${person.isSelf ? ' (you)' : ''} is editing ${person.activeFile}${canJump ? ' — click to open' : ''}`
                : person.user.name
            }
            onClick={canJump ? () => onSelectFile(person.activeFile) : undefined}
          >
            <span className="presence-dot" style={{ backgroundColor: person.user.color }} />
            <span className="presence-name">
              {person.user.name}
              {person.isSelf && <span className="presence-you"> (you)</span>}
            </span>
            {person.activeFile && <span className="presence-file">{person.activeFile}</span>}
          </div>
        );
      })}
    </div>
  );
}
