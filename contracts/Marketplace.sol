// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./NFTCollection.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Marketplace is IERC721Receiver, Ownable, ReentrancyGuard {
    // Name of the marketplace
    string public name;

    // Index of auctions
    uint256 public index = 0;

    // Structure to define auction properties
    struct Auction {
        uint256 index;
        address addressNFTCollection; // Address of the ERC721 NFT Collection contract
        address addressPaymentToken; // Address of the ERC20 Payment Token contract
        uint256 nftId; 
        address creator; 
        uint256 startPrice;
        uint256 endPrice;
        uint256 endAuction;
        bool isLiquidate;
    }

    struct FixedPriceSale {
        uint256 nftId;
        address addressNFTCollection;
        address addressPaymentToken;
        uint256 price;
        address seller;
        bool active;
    }

    mapping(uint256 => FixedPriceSale) public fixedPriceSales;
    mapping(address => uint256) public paymentTokens;
    mapping(address => uint256) public acceptedNFTCollection;
    // Array will all auctions
    Auction[] public allAuctions;

    event NewAuction(
        uint256 index,
        address addressNFTCollection,
        address addressPaymentToken,
        uint256 nftId,
        address mintedBy,
        uint256 startPrice,
        uint256 endPrice,
        uint256 endAuction
    );

    event NewFixedPriceSale(
        uint256 nftId,
        address addressNFTCollection,
        address addressPaymentToken,
        uint256 price,
        address seller
    );

    event FixedPriceSaleEnded(uint256 nftId);
    event AuctionFinished(uint256 auctionIndex, uint256 price);
    event NFTPurchased(uint256 nftId, address buyer);
    event NFTRefunded(uint256 auctionIndex, uint256 nftId, address claimedBy);

    modifier checkAuctionIndex(uint256 _auctionIndex) {
        require(_auctionIndex < allAuctions.length, "Invalid auction index");
        _;
    }

    constructor(string memory _name) {
        name = _name;
        paymentTokens[address(0)] = 1;
    }

    function createAuction(
        address _addressNFTCollection,
        address _addressPaymentToken,
        uint256 _nftId,
        uint256 _initialBid,
        uint256 _endBid,
        uint256 _AuctionPeriod
    ) external returns (uint256) {
        //Check is addresses are valid
        require(
            acceptedNFTCollection[_addressNFTCollection] == 1,
            "Invalid NFT Collection contract address"
        );
        require(
            paymentTokens[_addressPaymentToken] == 1,
            "Invalid Payment Token contract address"
        );
        require(_AuctionPeriod > 0, "Invalid auction period");
        require(_initialBid > 0, "Invalid initial bid price");
        require(_endBid > _initialBid, "Invalid end bid price");
        NFTCollection nftCollection = NFTCollection(_addressNFTCollection);
        require(
            nftCollection.ownerOf(_nftId) == msg.sender,
            "Caller is not the owner of the NFT"
        );
        require(
            nftCollection.getApproved(_nftId) == address(this),
            "Require NFT ownership transfer approval"
        );

        // Lock NFT in Marketplace contract
        nftCollection.transferNFTFrom(msg.sender, address(this), _nftId);
        // Create new Auction object
        Auction memory newAuction = Auction({
            index: index,
            addressNFTCollection: _addressNFTCollection,
            addressPaymentToken: _addressPaymentToken,
            nftId: _nftId,
            creator: msg.sender,
            startPrice: _initialBid,
            endPrice: _endBid,
            endAuction: block.timestamp + _AuctionPeriod,
            isLiquidate: false
        });
        allAuctions.push(newAuction); //update list
        index++; // increment auction sequence
        // Trigger event and return index of new auction
        emit NewAuction(
            index,
            _addressNFTCollection,
            _addressPaymentToken,
            _nftId,
            msg.sender,
            _initialBid,
            _endBid,
            block.timestamp + _AuctionPeriod
        );
        return index;
    }

    function bid(
        uint256 _auctionIndex,
        uint256 _newBid
    ) external payable checkAuctionIndex(_auctionIndex) nonReentrant {
        Auction storage auction = allAuctions[_auctionIndex];
        
        require(isOpen(_auctionIndex), "Auction is not open");
        require(
            _newBid > auction.startPrice,
            "New bid price must be higher than the current bid"
        );
        require(
            msg.sender != auction.creator,
            "Creator of the auction cannot place new bid"
        );
        require(auction.isLiquidate == false, "Auction is liquidated");
        uint256 sendingAmount;
        if (_newBid > auction.endPrice) {
                sendingAmount = auction.endPrice;
            } else {
                sendingAmount = _newBid;
            }
        if (auction.addressPaymentToken != address(0)) {
            // ERC20 token
            IERC20 paymentToken = IERC20(auction.addressPaymentToken);
            paymentToken.transferFrom(msg.sender, address(this), sendingAmount);
            paymentToken.transfer(auction.creator, sendingAmount);
        } else {
            // Ether
            require(msg.value >= _newBid * 10 ** 18, "Not enough value");
            if (msg.value > sendingAmount * 10 ** 18)
                payable(msg.sender).transfer(
                    msg.value - sendingAmount * 10 ** 18
                );
            payable(auction.creator).transfer(sendingAmount * 10 ** 18);
        }
        NFTCollection nftCollection = NFTCollection(
            auction.addressNFTCollection
        );
        nftCollection.transferNFTFrom(address(this), msg.sender, _auctionIndex);
        auction.isLiquidate = true;
        emit AuctionFinished(
            index,
            sendingAmount
        );
    }

    function createFixedPriceSale(
        address _addressNFTCollection,
        address _addressPaymentToken,
        uint256 _nftId,
        uint256 _price
    ) external {
        require(
            acceptedNFTCollection[_addressNFTCollection] == 1,
            "Invalid NFT Collection contract address"
        );
        require(
            paymentTokens[_addressPaymentToken] == 1,
            "Invalid Payment Token contract address"
        );
        require(_price > 0, "Invalid price");

        NFTCollection nftCollection = NFTCollection(_addressNFTCollection);
        require(
            nftCollection.ownerOf(_nftId) == msg.sender,
            "Caller is not the owner of the NFT"
        );
        require(
            nftCollection.getApproved(_nftId) == address(this),
            "Require NFT ownership transfer approval"
        );
        nftCollection.transferNFTFrom(msg.sender, address(this), _nftId);
        FixedPriceSale memory newSale = FixedPriceSale({
            nftId: _nftId,
            addressNFTCollection: _addressNFTCollection,
            addressPaymentToken: _addressPaymentToken,
            price: _price,
            seller: msg.sender,
            active: true
        });
        fixedPriceSales[_nftId] = newSale;
        emit NewFixedPriceSale(
            _nftId,
            _addressNFTCollection,
            _addressPaymentToken,
            _price,
            msg.sender
        );
    }

    function buyNFT(uint256 _nftId) external payable nonReentrant {
        FixedPriceSale storage sale = fixedPriceSales[_nftId];
        require(sale.active, "Sale is not active");

        if (sale.addressPaymentToken != address(0)) {
            //ERC20 token
            IERC20 paymentToken = IERC20(sale.addressPaymentToken);
            paymentToken.transferFrom(msg.sender, sale.seller, sale.price);
        } else {
            //Ether
            require(msg.value >= sale.price * 10 ** 18, "Not enough value");
            payable(sale.seller).transfer(sale.price * 10 ** 18);
            if (msg.value > sale.price * 10 ** 18)
                payable(msg.sender).transfer(msg.value - sale.price * 10 ** 18);
        }

        NFTCollection nftCollection = NFTCollection(sale.addressNFTCollection);
        nftCollection.transferNFTFrom(address(this), msg.sender, _nftId);

        sale.active = false;

        emit NFTPurchased(_nftId, msg.sender);
    }

    /**
     * Function used by the creator of an auction to get his NFT back
     * in case the auction is closed but there is no bider to make the NFT won't stay locked in the contract
     */
    function refund(
        uint256 _auctionIndex
    ) external checkAuctionIndex(_auctionIndex) {
        require(!isOpen(_auctionIndex), "Auction is still open");
        Auction storage auction = allAuctions[_auctionIndex];
        require(
            auction.creator == msg.sender,
            "Tokens can be claimed only by the creator of the auction"
        );
        require(
            auction.isLiquidate == false,
            "Existing bider for this auction"
        );

        // Get NFT Collection contract
        NFTCollection nftCollection = NFTCollection(
            auction.addressNFTCollection
        );
        // Transfer NFT back from marketplace contract to the creator of the auction
        nftCollection.transferFrom(
            address(this),
            auction.creator,
            auction.nftId
        );
        emit NFTRefunded(_auctionIndex, auction.nftId, msg.sender);
    }

    /**
     * Function used by the seller of an FixedPriceSale to get his NFT back
     * in case there is no buyer
     */
    function endFixedPriceSale(uint256 _nftId) external {
        FixedPriceSale storage sale = fixedPriceSales[_nftId];
        require(sale.seller == msg.sender, "Only the seller can end the sale");
        NFTCollection nftCollection = NFTCollection(sale.addressNFTCollection);
        nftCollection.transferNFTFrom(address(this), msg.sender, _nftId);

        sale.active = false;

        emit FixedPriceSaleEnded(_nftId);
    }

    // Check if an auction is open
    function isOpen(uint256 _auctionIndex) public view returns (bool) {
        Auction storage auction = allAuctions[_auctionIndex];
        if (block.timestamp >= auction.endAuction) return false;
        return true;
    }

    function addPaymentToken(address _addr) public onlyOwner {
        if (isContract(_addr) == true && isERC20Contract(_addr) == true)
            paymentTokens[_addr] = 1;
    }

    function addAcceptedNFTCollection(address _addr) public onlyOwner {
        if (isContract(_addr) == true && isERC721Contract(_addr) == true)
            acceptedNFTCollection[_addr] = 1;
    }

    function removePaymentToken(address _addr) public onlyOwner {
        if (paymentTokens[_addr] == 1) paymentTokens[_addr] = 0;
    }

    function removeAcceptedNFTCollection(address _addr) public onlyOwner {
        if (acceptedNFTCollection[_addr] == 1) acceptedNFTCollection[_addr] = 0;
    }

    function isERC20Contract(address _address) private view returns (bool) {
        (bool success, ) = _address.staticcall(
            abi.encodeWithSignature("totalSupply()")
        );
        return success;
    }

    function isERC721Contract(address _address) private view returns (bool) {
        (bool success, ) = _address.staticcall(
            abi.encodeWithSignature(
                "supportsInterface(bytes4)",
                bytes4(
                    keccak256("onERC721Received(address,address,uint256,bytes)")
                )
            )
        );
        return success;
    }

    function isContract(address _addr) private view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(_addr)
        }
        return size > 0;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
