BeforeAll {
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'Functions/UserDomainHelpers.ps1')
}

Describe 'Test-SafeUsernameSegment' {
    It 'accepts a normal account name' {
        Test-SafeUsernameSegment -Username 'first.last' | Should -BeTrue
    }
    It 'rejects a traversing or reserved account name' {
        foreach ($name in @('..', '../outside', '..\outside', 'user/name', 'user:name', 'CON.txt', 'user.')) {
            Test-SafeUsernameSegment -Username $name | Should -BeFalse
        }
    }
}
