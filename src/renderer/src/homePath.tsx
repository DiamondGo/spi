import { createContext, useContext } from 'react'
import { shortenHome } from './pathFormat'
export const HomeDirectory = createContext('')
export function usePathFormatter(): (path: string) => string {
  const home = useContext(HomeDirectory)
  return path => shortenHome(path, home)
}
