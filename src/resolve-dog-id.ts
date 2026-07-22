/**
 * Résout le numéro de série (stable, défini dans les seeders backend) en id
 * actuel du robot (peut changer d'un reseed à l'autre). Permet à .env de ne
 * dépendre que de la valeur qui ne change jamais.
 */
export async function resolveDogId(backendUrl: string, serialNumber: string): Promise<string> {
  const url = `${backendUrl}/api/v1/dogs/by-serial/${encodeURIComponent(serialNumber)}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(
      `Impossible de résoudre le numéro de série "${serialNumber}" auprès du backend ` +
        `(HTTP ${res.status}) — vérifie qu'il existe (node ace db:seed côté doggo) et que ` +
        `le backend est démarré et joignable sur ${backendUrl}.`
    )
  }

  const body = (await res.json()) as { data: { id: string } }
  return body.data.id
}
