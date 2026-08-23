import { useEffect, useState } from 'react';

export function useFileList(filesMap) {
  const [paths, setPaths] = useState(() => Array.from(filesMap.keys()).sort());

  useEffect(() => {
    const update = () => setPaths(Array.from(filesMap.keys()).sort());
    filesMap.observe(update);
    update();
    return () => filesMap.unobserve(update);
  }, [filesMap]);

  return paths;
}
