param(
  [Parameter(Mandatory = $true)]
  [string]$Token,
  [string]$ApiBase = "http://localhost:3000"
)

function Set-PrintJobPrinted {
  param(
    [Parameter(Mandatory = $true)]
    [string]$JobId
  )

  Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/print-jobs/$JobId/printed" -Headers @{ "x-agent-token" = $Token }
}

# Depois de imprimir o cupom no caixa, chame:
# Set-PrintJobPrinted -JobId $jobId
