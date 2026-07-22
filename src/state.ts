export interface RobotPosition {
  x: number
  y: number
  heading: number
}

export interface RobotState {
  position: RobotPosition
  battery: number
  connected: boolean
  inSession: boolean
  barking: boolean
  jumping: boolean
}

export const state: RobotState = {
  position: { x: 0, y: 0, heading: 0 },
  battery: 100,
  connected: false,
  inSession: false,
  barking: false,
  jumping: false,
}
