// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IERC7857.sol";
import "./interfaces/IERC7857Authorize.sol";
import "./interfaces/IERC7857Cloneable.sol";

/**
 * @title AgenticID
 * @notice ERC-7857 Agentic ID implementation. Cloned 1:1 from
 *         0gfoundation/agenticID-examples/examples/01-mint-and-manage
 *         (the same source as the testnet contract at
 *         0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F per ADR-08).
 *
 *         Used to mint iNFT anchors holding session-log rootHashes from
 *         our verifiable-execution OpenClaw plugin. On 0G mainnet
 *         (Aristotle, chainId 16661) this is OUR deploy — 0G has not
 *         published a public mainnet AgenticID example. See ADR-13 for
 *         the deploy-our-own rationale.
 *
 *         For full TEE/ZKP-validated production use, the
 *         `0gfoundation/0g-agent-nft` AgentNFT.sol is the production
 *         path; this contract is the audit-trail-friendly variant that
 *         underlies the entire AgenticID example ecosystem.
 */
contract AgenticID is ERC721Enumerable, AccessControl, Pausable, IERC7857, IERC7857Authorize, IERC7857Cloneable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 private _nextTokenId;
    uint256 public mintFee;
    address public creator;

    mapping(uint256 => IntelligentData[]) private _intelligentData;
    mapping(uint256 => string) private _tokenURIs;

    mapping(uint256 => address[]) private _authorizedUsers;
    mapping(uint256 => mapping(address => bool)) private _isAuthorizedUser;

    mapping(address => uint256[]) private _authorizedTokens;
    mapping(address => mapping(uint256 => bool)) private _isAuthorizedToken;

    mapping(uint256 => uint256) public cloneSource;
    mapping(address => address) public delegatedAssistant;
    mapping(uint256 => address) public tokenCreator;

    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event DelegateAccessSet(address indexed owner, address indexed assistant);

    constructor(
        string memory name,
        string memory symbol,
        uint256 _mintFee
    ) ERC721(name, symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        mintFee = _mintFee;
        creator = msg.sender;
    }

    // =========================================================================
    // Minting
    // =========================================================================

    function mint(address to) external payable whenNotPaused returns (uint256) {
        require(msg.value >= mintFee, "Insufficient mint fee");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        tokenCreator[tokenId] = msg.sender;
        return tokenId;
    }

    function mintWithRole(address to) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        tokenCreator[tokenId] = msg.sender;
        return tokenId;
    }

    function iMint(
        address to,
        IntelligentData[] calldata datas
    ) external payable whenNotPaused returns (uint256) {
        require(msg.value >= mintFee, "Insufficient mint fee");
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setIntelligentData(tokenId, datas);
        tokenCreator[tokenId] = msg.sender;
        return tokenId;
    }

    function iMintWithRole(
        address to,
        IntelligentData[] calldata datas,
        address _creator
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setIntelligentData(tokenId, datas);
        tokenCreator[tokenId] = _creator;
        return tokenId;
    }

    // =========================================================================
    // ERC-7857: Intelligent Data
    // =========================================================================

    function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _intelligentData[tokenId];
    }

    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata /* proofs */
    ) external override {
        require(ownerOf(tokenId) == from, "Not the owner");
        require(
            msg.sender == from ||
            isApprovedForAll(from, msg.sender) ||
            getApproved(tokenId) == msg.sender,
            "Not authorized to transfer"
        );

        _transfer(from, to, tokenId);
        _clearAuthorizations(tokenId);

        emit IntelligentTransfer(from, to, tokenId);
    }

    // =========================================================================
    // ERC-7857 Cloneable
    // =========================================================================

    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata /* proofs */
    ) external returns (uint256) {
        require(ownerOf(tokenId) == from, "Not the owner");
        require(
            msg.sender == from ||
            isApprovedForAll(from, msg.sender) ||
            getApproved(tokenId) == msg.sender,
            "Not authorized to clone"
        );

        uint256 newTokenId = _nextTokenId++;
        _safeMint(to, newTokenId);

        IntelligentData[] storage sourceData = _intelligentData[tokenId];
        for (uint256 i = 0; i < sourceData.length; i++) {
            _intelligentData[newTokenId].push(sourceData[i]);
        }

        cloneSource[newTokenId] = tokenId;
        tokenCreator[newTokenId] = tokenCreator[tokenId];

        emit IntelligentClone(from, to, tokenId, newTokenId);
        return newTokenId;
    }

    // =========================================================================
    // ERC-7857 Authorization
    // =========================================================================

    function authorizeUsage(uint256 tokenId, address user) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        require(!_isAuthorizedUser[tokenId][user], "Already authorized");
        require(_authorizedUsers[tokenId].length < 100, "Max authorizations reached");

        _authorizedUsers[tokenId].push(user);
        _isAuthorizedUser[tokenId][user] = true;

        _authorizedTokens[user].push(tokenId);
        _isAuthorizedToken[user][tokenId] = true;

        emit UsageAuthorized(tokenId, user);
    }

    function revokeAuthorization(uint256 tokenId, address user) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        require(_isAuthorizedUser[tokenId][user], "Not authorized");

        _isAuthorizedUser[tokenId][user] = false;

        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == user) {
                users[i] = users[users.length - 1];
                users.pop();
                break;
            }
        }

        _isAuthorizedToken[user][tokenId] = false;
        uint256[] storage tokens = _authorizedTokens[user];
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == tokenId) {
                tokens[i] = tokens[tokens.length - 1];
                tokens.pop();
                break;
            }
        }

        emit UsageRevoked(tokenId, user);
    }

    function isAuthorizedUser(uint256 tokenId, address user) external view returns (bool) {
        return _isAuthorizedUser[tokenId][user];
    }

    function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory) {
        return _authorizedUsers[tokenId];
    }

    function authorizedTokensOf(address user) external view returns (uint256[] memory) {
        return _authorizedTokens[user];
    }

    function batchAuthorizeUsage(uint256[] calldata tokenIds, address user) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "Not the owner");
            if (!_isAuthorizedUser[tokenIds[i]][user]) {
                require(_authorizedUsers[tokenIds[i]].length < 100, "Max authorizations reached");
                _authorizedUsers[tokenIds[i]].push(user);
                _isAuthorizedUser[tokenIds[i]][user] = true;
                emit UsageAuthorized(tokenIds[i], user);
            }
        }
    }

    // =========================================================================
    // Access Delegation
    // =========================================================================

    function delegateAccess(address assistant) external {
        delegatedAssistant[msg.sender] = assistant;
        emit DelegateAccessSet(msg.sender, assistant);
    }

    function revokeDelegateAccess() external {
        delete delegatedAssistant[msg.sender];
        emit DelegateAccessSet(msg.sender, address(0));
    }

    // =========================================================================
    // Token URI
    // =========================================================================

    function setTokenURI(uint256 tokenId, string calldata uri) external {
        require(ownerOf(tokenId) == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "Not authorized");
        _tokenURIs[tokenId] = uri;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        string memory uri = _tokenURIs[tokenId];
        if (bytes(uri).length > 0) return uri;
        return super.tokenURI(tokenId);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setMintFee(uint256 newFee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldFee = mintFee;
        mintFee = newFee;
        emit MintFeeUpdated(oldFee, newFee);
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _setIntelligentData(uint256 tokenId, IntelligentData[] calldata datas) internal {
        delete _intelligentData[tokenId];
        for (uint256 i = 0; i < datas.length; i++) {
            _intelligentData[tokenId].push(datas[i]);
        }
        emit IntelligentDataSet(tokenId, datas);
    }

    function _clearAuthorizations(uint256 tokenId) internal {
        address[] storage users = _authorizedUsers[tokenId];
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            _isAuthorizedUser[tokenId][user] = false;

            _isAuthorizedToken[user][tokenId] = false;
            uint256[] storage tokens = _authorizedTokens[user];
            for (uint256 j = 0; j < tokens.length; j++) {
                if (tokens[j] == tokenId) {
                    tokens[j] = tokens[tokens.length - 1];
                    tokens.pop();
                    break;
                }
            }
        }
        delete _authorizedUsers[tokenId];
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
