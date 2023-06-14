// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface tokenRecipient { 
    function receiveApproval(address _from, uint256 _value, address _token, bytes calldata _extraData) external; 
}

contract ERC20Mock is ERC20 {
    constructor(uint256 initialSupply, string memory name, string memory symbol) ERC20(name, symbol) {
        mint(msg.sender, initialSupply * 10 ** 18);
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}