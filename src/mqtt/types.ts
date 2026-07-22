export type RobotCommandType =
  | 'start_mission'
  | 'stop_mission'
  | 'emergency_stop'
  | 'start_session'
  | 'end_session'

export interface RobotCommandStep {
  stepId: string
  order: number
  actionCode: string
  parameters: Record<string, unknown>
}

export interface RobotCommandPayload {
  type: RobotCommandType
  runId?: string
  missionId?: string
  steps?: RobotCommandStep[]
}
